from __future__ import annotations

import sys
import unittest
from pathlib import Path


def _ensure_src_on_path() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


_ensure_src_on_path()

from martingale_research.data.candles import Candle  # noqa: E402
from martingale_research.execution import (  # noqa: E402
    AllowedStatesBundle,
    StrategyConfig,
    apply_previous_outcome,
    make_default_state,
    run_hourly_tick,
)


def _make_candles_from_dirs(dirs: list[bool]) -> list[Candle]:
    out: list[Candle] = []
    t = 0
    for d in dirs:
        o = 100.0
        c = 101.0 if d else 99.0
        out.append(Candle(open_time_ms=t, open=o, high=max(o, c), low=min(o, c), close=c, volume=1.0))
        t += 3600_000
    return out


class TestRuntime(unittest.TestCase):
    def setUp(self) -> None:
        self.strategy = StrategyConfig(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            risk_horizon_h=72,
            train_window_days=365,
            step_days=7,
            base_stake_u=2.0,
            max_steps=6,
            allowed_states_count=1,
        )

    def test_start_run_from_flat_state(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False])
        allowed = AllowedStatesBundle(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            allowed_states=frozenset({"DDDDDD"}),
        )
        state = make_default_state(strategy_version="demo")

        result = run_hourly_tick(
            candles=candles,
            strategy=self.strategy,
            allowed_states=allowed,
            state=state,
        )

        self.assertTrue(result.state.in_run)
        self.assertEqual(result.state.current_step, 1)
        self.assertEqual(result.state.total_runs_started, 1)
        self.assertEqual(result.decision.recommended_action, "START_RUN")

    def test_loss_advances_to_next_step(self) -> None:
        candles = _make_candles_from_dirs([True, True, True, True, True, True])
        allowed = AllowedStatesBundle(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            allowed_states=frozenset(),
        )
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=1,
            last_processed_candle_open_time_ms=None,
            last_state="DDDDDD",
            last_action="START_RUN",
            last_direction="D",
            last_reason="started",
            updated_at_utc="",
            total_runs_started=1,
            total_wins=0,
            total_losses=0,
            total_blowups=0,
        )

        result = run_hourly_tick(
            candles=candles,
            strategy=self.strategy,
            allowed_states=allowed,
            state=state,
            previous_outcome="loss",
        )

        self.assertTrue(result.state.in_run)
        self.assertEqual(result.state.current_step, 2)
        self.assertEqual(result.state.total_losses, 1)
        self.assertEqual(result.decision.recommended_action, "BET_STEP_2")
        self.assertEqual(result.decision.next_direction, "U")

    def test_loss_on_last_step_resets_and_counts_blowup(self) -> None:
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=6,
            last_processed_candle_open_time_ms=None,
            last_state="DUUUUD",
            last_action="BET_STEP_6",
            last_direction="U",
            last_reason="running",
            updated_at_utc="",
            total_runs_started=1,
            total_wins=0,
            total_losses=5,
            total_blowups=0,
        )

        resolved = apply_previous_outcome(state=state, outcome="loss", max_steps=6)

        self.assertFalse(resolved.in_run)
        self.assertIsNone(resolved.current_step)
        self.assertEqual(resolved.total_losses, 6)
        self.assertEqual(resolved.total_blowups, 1)

    def test_win_resets_to_flat(self) -> None:
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=3,
            last_processed_candle_open_time_ms=None,
            last_state="DUUUUD",
            last_action="BET_STEP_3",
            last_direction="U",
            last_reason="running",
            updated_at_utc="",
            total_runs_started=1,
            total_wins=0,
            total_losses=2,
            total_blowups=0,
        )

        resolved = apply_previous_outcome(state=state, outcome="win", max_steps=6)

        self.assertFalse(resolved.in_run)
        self.assertIsNone(resolved.current_step)
        self.assertEqual(resolved.total_wins, 1)
        self.assertEqual(resolved.total_losses, 2)


if __name__ == "__main__":
    unittest.main()
