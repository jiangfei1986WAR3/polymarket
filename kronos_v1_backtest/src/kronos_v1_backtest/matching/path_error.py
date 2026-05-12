from __future__ import annotations

from ..data.candles import Candle


def candle_return(c: Candle) -> float:
    if c.open == 0:
        return 0.0
    return (c.close - c.open) / c.open


def path_error_mse_returns(
    pred_known: list[Candle],
    true_known: list[Candle],
    time_decay: float = 1.0,
) -> float:
    """Mean squared error on per-candle returns for the known path.

    time_decay > 1.0 increases weight on more recent candles.
    """

    if len(pred_known) != len(true_known):
        raise ValueError("length mismatch")
    if not pred_known:
        raise ValueError("empty path")

    n = len(pred_known)
    weights = [time_decay**j for j in range(n)]
    denom = sum(weights)

    err = 0.0
    for p, t, w in zip(pred_known, true_known, weights):
        diff = candle_return(p) - candle_return(t)
        err += w * diff * diff

    return err / denom
