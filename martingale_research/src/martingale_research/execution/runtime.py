from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from martingale_research.data.candles import Candle

from .decision_engine import AllowedStatesBundle, DecisionReport, StrategyConfig, evaluate_decision
from .state_store import RuntimeState


@dataclass(frozen=True)
class HourlyTickResult:
    state: RuntimeState
    decision: DecisionReport


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def apply_previous_outcome(
    *,
    state: RuntimeState,
    outcome: str | None,
    max_steps: int,
) -> RuntimeState:
    if outcome is None:
        return state
    if outcome not in {"win", "loss"}:
        raise ValueError("outcome must be one of: win, loss")
    if not state.in_run or state.current_step is None:
        raise ValueError("cannot apply outcome when no martingale run is active")

    if outcome == "win":
        return RuntimeState(
            strategy_version=state.strategy_version,
            in_run=False,
            current_step=None,
            last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
            last_state=state.last_state,
            last_action="RESOLVED_WIN",
            last_direction=state.last_direction,
            last_reason="上一小时结果为赢，本轮马丁结束并重置为空仓。",
            updated_at_utc=_now_utc(),
            total_runs_started=state.total_runs_started,
            total_wins=state.total_wins + 1,
            total_losses=state.total_losses,
            total_blowups=state.total_blowups,
        )

    next_step = state.current_step + 1
    if next_step > max_steps:
        return RuntimeState(
            strategy_version=state.strategy_version,
            in_run=False,
            current_step=None,
            last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
            last_state=state.last_state,
            last_action="RESOLVED_BLOWUP",
            last_direction=state.last_direction,
            last_reason="上一小时结果为输，且已达到最大步数，本轮记为爆仓并重置为空仓。",
            updated_at_utc=_now_utc(),
            total_runs_started=state.total_runs_started,
            total_wins=state.total_wins,
            total_losses=state.total_losses + 1,
            total_blowups=state.total_blowups + 1,
        )

    return RuntimeState(
        strategy_version=state.strategy_version,
        in_run=True,
        current_step=next_step,
        last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
        last_state=state.last_state,
        last_action=f"ADVANCE_TO_STEP_{next_step}",
        last_direction=state.last_direction,
        last_reason=f"上一小时结果为输，本轮推进到第 {next_step} 步。",
        updated_at_utc=_now_utc(),
        total_runs_started=state.total_runs_started,
        total_wins=state.total_wins,
        total_losses=state.total_losses + 1,
        total_blowups=state.total_blowups,
    )


def apply_decision_to_state(
    *,
    state: RuntimeState,
    decision: DecisionReport,
) -> RuntimeState:
    if decision.recommended_action == "START_RUN":
        return RuntimeState(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=1,
            last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
            last_state=decision.current_state,
            last_action=decision.recommended_action,
            last_direction=decision.next_direction,
            last_reason=decision.reason,
            updated_at_utc=_now_utc(),
            total_runs_started=state.total_runs_started + 1,
            total_wins=state.total_wins,
            total_losses=state.total_losses,
            total_blowups=state.total_blowups,
        )

    if decision.recommended_action.startswith("BET_STEP_"):
        return RuntimeState(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=decision.next_step,
            last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
            last_state=decision.current_state,
            last_action=decision.recommended_action,
            last_direction=decision.next_direction,
            last_reason=decision.reason,
            updated_at_utc=_now_utc(),
            total_runs_started=state.total_runs_started,
            total_wins=state.total_wins,
            total_losses=state.total_losses,
            total_blowups=state.total_blowups,
        )

    return RuntimeState(
        strategy_version=state.strategy_version,
        in_run=False,
        current_step=None,
        last_processed_candle_open_time_ms=state.last_processed_candle_open_time_ms,
        last_state=decision.current_state,
        last_action=decision.recommended_action,
        last_direction=decision.next_direction,
        last_reason=decision.reason,
        updated_at_utc=_now_utc(),
        total_runs_started=state.total_runs_started,
        total_wins=state.total_wins,
        total_losses=state.total_losses,
        total_blowups=state.total_blowups,
    )


def run_hourly_tick(
    *,
    candles: list[Candle],
    strategy: StrategyConfig,
    allowed_states: AllowedStatesBundle,
    state: RuntimeState,
    previous_outcome: str | None = None,
) -> HourlyTickResult:
    progressed = apply_previous_outcome(state=state, outcome=previous_outcome, max_steps=strategy.max_steps)
    decision = evaluate_decision(
        candles=candles,
        strategy=strategy,
        allowed_states=allowed_states,
        current_step=progressed.current_step if progressed.in_run else None,
    )
    next_state = apply_decision_to_state(state=progressed, decision=decision)
    return HourlyTickResult(state=next_state, decision=decision)


def mark_processed_candle(state: RuntimeState, candle_open_time_ms: int) -> RuntimeState:
    return RuntimeState(
        strategy_version=state.strategy_version,
        in_run=state.in_run,
        current_step=state.current_step,
        last_processed_candle_open_time_ms=candle_open_time_ms,
        last_state=state.last_state,
        last_action=state.last_action,
        last_direction=state.last_direction,
        last_reason=state.last_reason,
        updated_at_utc=state.updated_at_utc,
        total_runs_started=state.total_runs_started,
        total_wins=state.total_wins,
        total_losses=state.total_losses,
        total_blowups=state.total_blowups,
    )
