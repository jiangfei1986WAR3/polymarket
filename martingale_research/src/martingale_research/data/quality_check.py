from __future__ import annotations

from dataclasses import dataclass

from .candles import Candle


@dataclass(frozen=True)
class QualityReport:
    n: int
    duplicates: int
    missing: int
    invalid_ohlc: int


def quality_check_1h(candles: list[Candle]) -> QualityReport:
    if not candles:
        return QualityReport(n=0, duplicates=0, missing=0, invalid_ohlc=0)

    duplicates = 0
    missing = 0
    invalid_ohlc = 0

    prev_t = None
    for c in candles:
        if c.high < max(c.open, c.close) or c.low > min(c.open, c.close):
            invalid_ohlc += 1
        if c.volume < 0:
            invalid_ohlc += 1

        if prev_t is not None:
            if c.open_time_ms == prev_t:
                duplicates += 1
            dt = c.open_time_ms - prev_t
            if dt > 3600_000:
                missing += (dt // 3600_000) - 1
        prev_t = c.open_time_ms

    return QualityReport(n=len(candles), duplicates=duplicates, missing=missing, invalid_ohlc=invalid_ohlc)
