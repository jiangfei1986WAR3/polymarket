from __future__ import annotations

from dataclasses import dataclass

from ..data.candles import Candle


@dataclass(frozen=True)
class Sample:
    i: int
    model_input: list[Candle]
    known_true: list[Candle]
    target_true: Candle


def build_sample(
    candles: list[Candle],
    i: int,
    context_length: int,
    known_path_length: int = 11,
) -> Sample:
    """Build a sample with strict no-leak indexing.

    Timeline (target index = i):

    - known_true: candles[i-known_path_length : i]      (length = known_path_length)
    - target_true: candles[i]
    - model_input ends at candles[i-known_path_length-1]

    With known_path_length=11, model_input ends at i-12.
    """

    if known_path_length <= 0:
        raise ValueError("known_path_length must be positive")
    if context_length <= 0:
        raise ValueError("context_length must be positive")
    if i < known_path_length + context_length:
        raise ValueError("i too small for given context_length and known_path_length")
    if i >= len(candles):
        raise ValueError("i out of range")

    input_end_idx = i - known_path_length - 1
    input_start_idx = input_end_idx - context_length + 1

    if input_start_idx < 0:
        raise ValueError("not enough history")

    model_input = candles[input_start_idx : input_end_idx + 1]
    known_true = candles[i - known_path_length : i]
    target_true = candles[i]

    if len(model_input) != context_length:
        raise AssertionError("model_input length mismatch")
    if len(known_true) != known_path_length:
        raise AssertionError("known_true length mismatch")

    return Sample(i=i, model_input=model_input, known_true=known_true, target_true=target_true)
