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
from martingale_research.execution import AllowedStatesBundle, StrategyConfig, evaluate_decision  # noqa: E402


def _make_candles_from_dirs(dirs: list[bool]) -> list[Candle]:
    out: list[Candle] = []
    t = 0
    for d in dirs:
        o = 100.0
        c = 101.0 if d else 99.0
        out.append(Candle(open_time_ms=t, open=o, high=max(o, c), low=min(o, c), close=c, volume=1.0))
        t += 3600_000
    return out


class TestDecisionEngine(unittest.TestCase):
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

    def test_flat_mode_blocks_when_state_not_allowed(self) -> None:
        allowed = AllowedStatesBundle(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            allowed_states=frozenset({"DDDDDD"}),
        )
        candles = _make_candles_from_dirs([True, True, True, True, True, True])

        report = evaluate_decision(candles=candles, strategy=self.strategy, allowed_states=allowed)

        self.assertEqual(report.current_state, "UUUUUU")
        self.assertFalse(report.is_allowed)
        self.assertEqual(report.recommended_action, "BLOCK")
        self.assertIsNone(report.next_direction)

    def test_flat_mode_starts_when_state_allowed(self) -> None:
        allowed = AllowedStatesBundle(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            allowed_states=frozenset({"DDDDDD"}),
        )
        candles = _make_candles_from_dirs([False, False, False, False, False, False])

        report = evaluate_decision(candles=candles, strategy=self.strategy, allowed_states=allowed)

        self.assertTrue(report.is_allowed)
        self.assertEqual(report.recommended_action, "START_RUN")
        self.assertEqual(report.next_step, 1)
        self.assertEqual(report.next_direction, "D")

    def test_in_run_uses_current_step_direction(self) -> None:
        allowed = AllowedStatesBundle(
            version="demo",
            pattern="DUUUUU",
            coverage_target=0.55,
            allowed_states=frozenset(),
        )
        candles = _make_candles_from_dirs([True, True, True, True, True, True])

        report = evaluate_decision(
            candles=candles,
            strategy=self.strategy,
            allowed_states=allowed,
            current_step=3,
        )

        self.assertTrue(report.in_run)
        self.assertEqual(report.recommended_action, "BET_STEP_3")
        self.assertEqual(report.next_direction, "U")


if __name__ == "__main__":
    unittest.main()
