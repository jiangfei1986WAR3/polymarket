from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Candle:
    open_time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def direction_up(self) -> bool:
        return self.close >= self.open
