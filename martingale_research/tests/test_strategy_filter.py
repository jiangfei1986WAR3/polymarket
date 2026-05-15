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
from martingale_research.martingale import (  # noqa: E402
    ConditionalRiskRow,
    MartingaleConfig,
    backtest_with_allowed_states,
    run_walk_forward,
    select_allowed_states,
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


class TestStrategyFilter(unittest.TestCase):
    def test_select_allowed_states_hits_coverage_target(self) -> None:
        rows = [
            ConditionalRiskRow(0, "DDDDDD", 6, 0.10, 0.00, 10.0, 10.0, 3, 0.20, 0.00, 12.0, 12.0),
            ConditionalRiskRow(1, "UDDDDD", 3, 0.20, 0.00, 11.0, 11.0, 4, 0.30, 0.00, 13.0, 13.0),
            ConditionalRiskRow(2, "DUDDDD", 1, 0.30, 0.00, 12.0, 12.0, 2, 0.40, 0.00, 14.0, 14.0),
        ]

        selected = select_allowed_states(rows, coverage_target=0.5)

        self.assertEqual(selected.allowed_state_bits, (0,))
        self.assertEqual(selected.allowed_state_strs, ("DDDDDD",))
        self.assertAlmostEqual(selected.train_coverage, 0.6)
        self.assertAlmostEqual(selected.test_coverage, 3 / 9)
        self.assertAlmostEqual(selected.train_weighted_p6, 0.10)
        self.assertAlmostEqual(selected.test_weighted_p6, 0.20)

    def test_backtest_with_allowed_states_only_enters_when_state_allowed(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False, True, True])
        cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)
        bits_uuuuuu = (1 << 6) - 1

        result = backtest_with_allowed_states(
            candles=candles,
            pattern_bits=bits_uuuuuu,
            allowed_state_bits={0},
            eval_start_i=6,
            cfg=cfg,
            state_len=6,
        )

        self.assertEqual(result.n_entries, 1)
        self.assertEqual(result.n_bets, 1)
        self.assertEqual(result.n_blowups, 0)
        self.assertEqual(result.pnl_u, 2.0)

    def test_backtest_with_allowed_states_respects_eval_end(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False, True, True, True])
        cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)
        bits_uuuuuu = (1 << 6) - 1

        result = backtest_with_allowed_states(
            candles=candles,
            pattern_bits=bits_uuuuuu,
            allowed_state_bits={0},
            eval_start_i=6,
            eval_end_i_exclusive=7,
            cfg=cfg,
            state_len=6,
        )

        self.assertEqual(result.n_hours, 1)
        self.assertEqual(result.n_entries, 1)
        self.assertEqual(result.n_bets, 1)
        self.assertEqual(result.pnl_u, 2.0)

    def test_run_walk_forward_smoke(self) -> None:
        candles = _make_candles_from_dirs(([False] * 6 + [True] * 6) * 8)
        cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)

        result = run_walk_forward(
            candles=candles,
            pattern_str="UUUUUU",
            coverage_target=0.5,
            train_window_h=24,
            step_h=6,
            horizon_h=6,
            state_len=6,
            cfg=cfg,
        )

        self.assertGreaterEqual(result.n_steps, 1)
        self.assertIsNotNone(result.latest_allowed_states)


if __name__ == "__main__":
    unittest.main()
