from __future__ import annotations

import csv
from pathlib import Path

from .candles import Candle


def load_binance_klines_csv(path: str | Path) -> list[Candle]:
    """Load a simple CSV with at least: open_time, open, high, low, close, volume.

    open_time is expected in milliseconds.
    """

    p = Path(path)
    candles: list[Candle] = []

    with p.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required = {"open_time", "open", "high", "low", "close", "volume"}
        if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
            raise ValueError(f"CSV must contain columns: {sorted(required)}")

        for row in reader:
            candles.append(
                Candle(
                    open_time_ms=int(float(row["open_time"])),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row["volume"]),
                )
            )

    candles.sort(key=lambda c: c.open_time_ms)
    return candles
