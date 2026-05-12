from __future__ import annotations

import random
from dataclasses import dataclass

from ..data.candles import Candle
from .path_error import path_error_mse_returns


@dataclass(frozen=True)
class PredPath:
    candles: list[Candle]  # length = horizon


def topk_by_known_path_error(
    paths: list[PredPath],
    true_known: list[Candle],
    known_path_length: int,
    k: int,
    time_decay: float = 1.0,
) -> list[PredPath]:
    if k <= 0:
        raise ValueError("k must be positive")
    if k > len(paths):
        raise ValueError("k cannot exceed number of paths")

    scored = []
    for p in paths:
        pred_known = p.candles[:known_path_length]
        e = path_error_mse_returns(pred_known, true_known, time_decay=time_decay)
        scored.append((e, p))

    scored.sort(key=lambda t: t[0])
    return [p for _, p in scored[:k]]


def random_k(paths: list[PredPath], k: int, rng: random.Random) -> list[PredPath]:
    if k <= 0:
        raise ValueError("k must be positive")
    if k > len(paths):
        raise ValueError("k cannot exceed number of paths")
    idx = list(range(len(paths)))
    rng.shuffle(idx)
    return [paths[i] for i in idx[:k]]


def q_from_paths_pred_close_gt_open(paths: list[PredPath], target_idx: int) -> float:
    if not paths:
        raise ValueError("empty paths")

    votes = 0
    for p in paths:
        c = p.candles[target_idx]
        votes += 1 if c.close > c.open else 0

    return votes / len(paths)
