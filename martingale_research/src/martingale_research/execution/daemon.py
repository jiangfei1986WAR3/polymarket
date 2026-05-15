from __future__ import annotations

from dataclasses import dataclass

from martingale_research.data.candles import Candle

from .adapters import BrokerEvent, ExecutionAdapter
from .decision_engine import AllowedStatesBundle, StrategyConfig
from .runtime import mark_processed_candle, run_hourly_tick
from .state_store import RuntimeState


@dataclass(frozen=True)
class CandleProcessReport:
    processed_candle_open_time_ms: int
    resolved_outcome: str | None
    action: str
    direction: str | None
    broker_event: BrokerEvent | None
    state: RuntimeState


@dataclass(frozen=True)
class DaemonCycleReport:
    mode: str
    processed_count: int
    state: RuntimeState
    reports: tuple[CandleProcessReport, ...]


def _direction(candle: Candle) -> str:
    return "U" if candle.close > candle.open else "D"


def _infer_previous_outcome(state: RuntimeState, candle: Candle) -> str | None:
    if not state.in_run or state.last_direction is None:
        return None
    if state.last_action != "START_RUN" and not state.last_action.startswith("BET_STEP_"):
        return None
    return "win" if _direction(candle) == state.last_direction else "loss"


def _process_single_candle(
    *,
    candles_prefix: list[Candle],
    strategy: StrategyConfig,
    allowed_states: AllowedStatesBundle,
    state: RuntimeState,
    adapter: ExecutionAdapter,
) -> CandleProcessReport:
    candle = candles_prefix[-1]
    outcome = _infer_previous_outcome(state, candle)
    tick = run_hourly_tick(
        candles=candles_prefix,
        strategy=strategy,
        allowed_states=allowed_states,
        state=state,
        previous_outcome=outcome,
    )
    next_target_open_time_ms = candle.open_time_ms + 3600_000
    broker_event = adapter.handle_decision(
        decision=tick.decision,
        target_candle_open_time_ms=next_target_open_time_ms,
    )
    next_state = mark_processed_candle(tick.state, candle.open_time_ms)
    return CandleProcessReport(
        processed_candle_open_time_ms=candle.open_time_ms,
        resolved_outcome=outcome,
        action=tick.decision.recommended_action,
        direction=tick.decision.next_direction,
        broker_event=broker_event,
        state=next_state,
    )


def process_available_candles(
    *,
    candles: list[Candle],
    strategy: StrategyConfig,
    allowed_states: AllowedStatesBundle,
    state: RuntimeState,
    adapter: ExecutionAdapter,
) -> DaemonCycleReport:
    if len(candles) < 6:
        raise ValueError("need at least 6 candles to run daemon cycle")

    if state.last_processed_candle_open_time_ms is None:
        report = _process_single_candle(
            candles_prefix=candles,
            strategy=strategy,
            allowed_states=allowed_states,
            state=state,
            adapter=adapter,
        )
        return DaemonCycleReport(
            mode="bootstrap",
            processed_count=1,
            state=report.state,
            reports=(report,),
        )

    reports: list[CandleProcessReport] = []
    for i, candle in enumerate(candles):
        if candle.open_time_ms <= state.last_processed_candle_open_time_ms:
            continue
        report = _process_single_candle(
            candles_prefix=candles[: i + 1],
            strategy=strategy,
            allowed_states=allowed_states,
            state=state,
            adapter=adapter,
        )
        state = report.state
        reports.append(report)

    if not reports:
        return DaemonCycleReport(mode="idle", processed_count=0, state=state, reports=())

    return DaemonCycleReport(
        mode="process_new_candles",
        processed_count=len(reports),
        state=state,
        reports=tuple(reports),
    )
