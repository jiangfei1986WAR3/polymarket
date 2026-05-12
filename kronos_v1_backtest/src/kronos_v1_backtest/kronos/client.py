from __future__ import annotations

import json
import random
from dataclasses import dataclass
from typing import Protocol

import requests

from ..data.candles import Candle
from ..matching.selector import PredPath


@dataclass(frozen=True)
class KronosRequest:
    candles: list[Candle]
    horizon: int
    n_paths: int


class KronosClient(Protocol):
    def predict_paths(self, req: KronosRequest) -> list[PredPath]:
        ...


class MockKronosClient:
    """Deterministic mock for plumbing/tests (NOT a real model)."""

    def __init__(self, seed: int = 0):
        self._seed = seed

    def predict_paths(self, req: KronosRequest) -> list[PredPath]:
        rng = random.Random(self._seed + req.candles[-1].open_time_ms)
        last_close = req.candles[-1].close
        paths: list[PredPath] = []

        for _ in range(req.n_paths):
            price = last_close
            cs: list[Candle] = []
            t0 = req.candles[-1].open_time_ms + 3600_000
            for h in range(req.horizon):
                open_ = price
                step = rng.gauss(0.0, 0.002)
                close_ = open_ * (1.0 + step)
                high_ = max(open_, close_) * (1.0 + abs(rng.gauss(0.0, 0.0005)))
                low_ = min(open_, close_) * (1.0 - abs(rng.gauss(0.0, 0.0005)))
                vol = abs(rng.gauss(100.0, 10.0))

                cs.append(
                    Candle(
                        open_time_ms=t0 + 3600_000 * h,
                        open=float(open_),
                        high=float(high_),
                        low=float(low_),
                        close=float(close_),
                        volume=float(vol),
                    )
                )
                price = close_

            paths.append(PredPath(candles=cs))

        return paths


class HttpKronosClient:
    """HTTP client for a locally deployed Kronos service.

    The exact payload/endpoint may need adapting to your deployment.
    """

    def __init__(self, base_url: str, timeout_s: float = 30.0):
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s

    def predict_paths(self, req: KronosRequest) -> list[PredPath]:
        payload = {
            "candles": [
                {
                    "open_time_ms": c.open_time_ms,
                    "open": c.open,
                    "high": c.high,
                    "low": c.low,
                    "close": c.close,
                    "volume": c.volume,
                }
                for c in req.candles
            ],
            "horizon": req.horizon,
            "n_paths": req.n_paths,
        }

        r = requests.post(
            f"{self._base_url}/predict_paths",
            data=json.dumps(payload),
            headers={"content-type": "application/json"},
            timeout=self._timeout_s,
        )
        r.raise_for_status()
        data = r.json()

        paths: list[PredPath] = []
        for path in data["paths"]:
            cs = [
                Candle(
                    open_time_ms=int(c["open_time_ms"]),
                    open=float(c["open"]),
                    high=float(c["high"]),
                    low=float(c["low"]),
                    close=float(c["close"]),
                    volume=float(c.get("volume", 0.0)),
                )
                for c in path
            ]
            paths.append(PredPath(candles=cs))

        return paths
