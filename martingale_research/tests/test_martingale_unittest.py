from __future__ import annotations

import sys
import unittest
from pathlib import Path


def _ensure_src_on_path() -> None:
    # Allows running via: python -m unittest discover -s tests
    root = Path(__file__).resolve().parents[1]
    src = root / 'src'
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


_ensure_src_on_path()

from martingale_research.data.candles import Candle  # noqa: E402
from martingale_research.martingale import MartingaleConfig, backtest_pattern  # noqa: E402


def _make_candles_from_dirs(dirs: list[bool]) -> list[Candle]:
    out: list[Candle] = []
    t = 0
    for d in dirs:
        o = 100.0
        c = 101.0 if d else 99.0
        out.append(Candle(open_time_ms=t, open=o, high=max(o, c), low=min(o, c), close=c, volume=1.0))
        t += 3600_000
    return out


class TestMartingaleEnumeratePatterns(unittest.TestCase):
    def test_backtest_pattern_all_wins(self) -> None:
        # Pattern UUUUUU over all-up candles => always win at step1.
        candles = _make_candles_from_dirs([True] * 24)
        cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)

        bits_uuuuuu = (1 << 6) - 1
        r = backtest_pattern(candles=candles, pattern_bits=bits_uuuuuu, cfg=cfg)

        self.assertEqual(r.n_bets, 24)
        self.assertEqual(r.n_losses, 0)
        self.assertEqual(r.n_level6_losses, 0)
        self.assertEqual(r.pnl_u, 24 * 2.0)

    def test_backtest_pattern_triggers_level6_loss_and_resets(self) -> None:
        # Always predicts up, but candles always down => every 6 bets hit 6 losses and reset.
        candles = _make_candles_from_dirs([False] * 18)  # 3 cycles
        cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)

        bits_uuuuuu = (1 << 6) - 1
        r = backtest_pattern(candles=candles, pattern_bits=bits_uuuuuu, cfg=cfg)

        self.assertEqual(r.n_bets, 18)
        self.assertEqual(r.n_wins, 0)
        self.assertEqual(r.n_losses, 18)
        self.assertEqual(r.n_level6_losses, 3)
        self.assertEqual(r.level6_loss_gaps, [6, 6])
        self.assertEqual(r.pnl_u, -3 * 126.0)


if __name__ == '__main__':
    unittest.main()

