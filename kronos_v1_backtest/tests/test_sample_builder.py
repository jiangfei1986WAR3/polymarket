from __future__ import annotations

from kronos_v1_backtest.backtest.sample_builder import build_sample
from kronos_v1_backtest.data.candles import Candle


def _make_candles(n: int) -> list[Candle]:
    out: list[Candle] = []
    t = 0
    for i in range(n):
        out.append(
            Candle(
                open_time_ms=t,
                open=float(100 + i),
                high=float(101 + i),
                low=float(99 + i),
                close=float(100 + i),
                volume=1.0,
            )
        )
        t += 3600_000
    return out


def test_build_sample_strict_indices() -> None:
    candles = _make_candles(1000)
    i = 600
    context = 512
    known = 11

    s = build_sample(candles, i=i, context_length=context, known_path_length=known)

    assert s.i == i
    assert len(s.model_input) == context
    assert len(s.known_true) == known
    assert s.target_true == candles[i]

    # model_input must end at i-known-1 (= i-12)
    assert s.model_input[-1] == candles[i - known - 1]
    # known_true must end at i-1
    assert s.known_true[-1] == candles[i - 1]
