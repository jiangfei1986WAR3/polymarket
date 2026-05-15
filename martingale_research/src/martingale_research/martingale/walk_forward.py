from __future__ import annotations

from dataclasses import dataclass

from martingale_research.data.candles import Candle

from .enumerate_patterns import MartingaleConfig
from .strategy_filter import (
    AllowedStatesSelection,
    FilteredBacktestResult,
    backtest_with_allowed_states,
    conditional_risk_rows_from_indices,
    pattern_str_to_bits,
    select_allowed_states,
)


@dataclass(frozen=True)
class WalkForwardStep:
    step_index: int
    train_start_i: int
    train_end_i_exclusive: int
    test_start_i: int
    test_end_i_exclusive: int
    allowed_states_count: int
    train_coverage: float
    test_entries: int
    test_blowups: int
    test_pnl_u: float
    test_max_drawdown_u: float


@dataclass(frozen=True)
class WalkForwardResult:
    pattern_str: str
    coverage_target: float
    train_window_h: int
    step_h: int
    n_steps: int
    total_entries: int
    total_blowups: int
    total_pnl_u: float
    max_step_drawdown_u: float
    max_cumulative_drawdown_u: float
    avg_entries_per_step: float
    steps: tuple[WalkForwardStep, ...]
    latest_allowed_states: AllowedStatesSelection | None


def run_walk_forward(
    *,
    candles: list[Candle],
    pattern_str: str,
    coverage_target: float,
    train_window_h: int = 365 * 24,
    step_h: int = 7 * 24,
    horizon_h: int = 72,
    state_len: int = 6,
    cfg: MartingaleConfig | None = None,
) -> WalkForwardResult:
    if train_window_h <= 0:
        raise ValueError("train_window_h must be positive")
    if step_h <= 0:
        raise ValueError("step_h must be positive")
    if horizon_h <= 0:
        raise ValueError("horizon_h must be positive")
    min_needed = train_window_h + step_h + state_len + horizon_h
    if len(candles) < min_needed:
        raise ValueError(
            f"not enough candles for walk-forward: need at least {min_needed}, got {len(candles)}"
        )

    cfg = cfg or MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)
    pattern_bits = pattern_str_to_bits(pattern_str)

    steps: list[WalkForwardStep] = []
    latest_selection: AllowedStatesSelection | None = None
    cumulative_equity = 0.0
    cumulative_peak = 0.0
    cumulative_max_drawdown = 0.0

    min_test_start = train_window_h
    max_test_start = len(candles) - step_h
    step_index = 0

    for test_start_i in range(min_test_start, max_test_start + 1, step_h):
        train_start_i = max(0, test_start_i - train_window_h)
        train_end_i_exclusive = test_start_i
        test_end_i_exclusive = min(len(candles), test_start_i + step_h)

        train_eval_start = max(train_start_i + state_len, state_len)
        train_eval_end_exclusive = train_end_i_exclusive - horizon_h
        if train_eval_end_exclusive <= train_eval_start:
            continue

        train_start_indices = list(range(train_eval_start, train_eval_end_exclusive))
        rows = conditional_risk_rows_from_indices(
            candles=candles,
            pattern_bits=pattern_bits,
            start_indices=train_start_indices,
            horizon_h=horizon_h,
            state_len=state_len,
        )
        selection = select_allowed_states(rows, coverage_target=coverage_target)
        latest_selection = selection

        bt = backtest_with_allowed_states(
            candles=candles,
            pattern_bits=pattern_bits,
            allowed_state_bits=set(selection.allowed_state_bits),
            eval_start_i=test_start_i,
            eval_end_i_exclusive=test_end_i_exclusive,
            cfg=cfg,
            state_len=state_len,
        )

        steps.append(
            WalkForwardStep(
                step_index=step_index,
                train_start_i=train_start_i,
                train_end_i_exclusive=train_end_i_exclusive,
                test_start_i=test_start_i,
                test_end_i_exclusive=test_end_i_exclusive,
                allowed_states_count=len(selection.allowed_state_bits),
                train_coverage=selection.train_coverage,
                test_entries=bt.n_entries,
                test_blowups=bt.n_blowups,
                test_pnl_u=bt.pnl_u,
                test_max_drawdown_u=bt.max_drawdown_u,
            )
        )
        for equity_point in bt.equity_curve_u:
            combined_equity = cumulative_equity + equity_point
            cumulative_peak = max(cumulative_peak, combined_equity)
            cumulative_max_drawdown = max(cumulative_max_drawdown, cumulative_peak - combined_equity)
        cumulative_equity += bt.pnl_u
        step_index += 1

    if not steps:
        raise ValueError("walk-forward produced no steps")

    total_entries = sum(s.test_entries for s in steps)
    total_blowups = sum(s.test_blowups for s in steps)
    total_pnl = sum(s.test_pnl_u for s in steps)
    max_step_dd = max(s.test_max_drawdown_u for s in steps)

    return WalkForwardResult(
        pattern_str=pattern_str,
        coverage_target=coverage_target,
        train_window_h=train_window_h,
        step_h=step_h,
        n_steps=len(steps),
        total_entries=total_entries,
        total_blowups=total_blowups,
        total_pnl_u=total_pnl,
        max_step_drawdown_u=max_step_dd,
        max_cumulative_drawdown_u=cumulative_max_drawdown,
        avg_entries_per_step=(total_entries / len(steps)) if steps else 0.0,
        steps=tuple(steps),
        latest_allowed_states=latest_selection,
    )
