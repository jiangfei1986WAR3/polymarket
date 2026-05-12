from __future__ import annotations

from dataclasses import dataclass

from kronos_v1_backtest.data.candles import Candle

from .enumerate_patterns import MartingaleConfig, pattern_bits_to_dirs


@dataclass(frozen=True)
class ConditionalRiskRow:
    state_bits: int
    state_str: str

    train_n: int
    train_p_level6: float
    train_p_gap6: float
    train_ttf_mean_h: float
    train_ttf_p50_h: float

    test_n: int
    test_p_level6: float
    test_p_gap6: float
    test_ttf_mean_h: float
    test_ttf_p50_h: float


def _dirs_to_bits(dirs_oldest_to_newest: list[bool]) -> int:
    bits = 0
    for i, d in enumerate(dirs_oldest_to_newest):
        if d:
            bits |= 1 << i
    return bits


def _bits_to_state_str(bits: int, n: int) -> str:
    # bit0 corresponds to oldest.
    out = []
    for i in range(n):
        out.append('U' if ((bits >> i) & 1) else 'D')
    return ''.join(out)


def _median(xs: list[int]) -> float:
    if not xs:
        return 0.0
    ys = sorted(xs)
    m = len(ys) // 2
    if len(ys) % 2 == 1:
        return float(ys[m])
    return (ys[m - 1] + ys[m]) / 2.0


def _simulate_window(
    *,
    candles: list[Candle],
    start_i: int,
    horizon_h: int,
    pattern_bits: int,
    cfg: MartingaleConfig,
) -> tuple[bool, int | None, bool]:
    """Simulate starting a fresh martingale at start_i for horizon_h candles.

    Returns:
      - has_level6: whether any 6-loss blowup occurred
      - ttf_h: time-to-first blowup in hours (1..horizon_h), or None
      - has_gap6: whether any consecutive blowups occurred (gap == 6)
    """

    end_i = min(len(candles), start_i + horizon_h)
    if end_i - start_i <= 0:
        return (False, None, False)

    level = 0
    pattern_dirs = pattern_bits_to_dirs(pattern_bits, cfg.pattern_len)

    blowup_indices: list[int] = []

    for i in range(start_i, end_i):
        c = candles[i]
        actual_up = c.close > c.open
        pred_up = pattern_dirs[level]
        won = pred_up == actual_up
        # Update level (ignore pnl details here)
        if won:
            level = 0
        else:
            level += 1
            if level >= cfg.max_steps:
                blowup_indices.append(i)
                level = 0

    if not blowup_indices:
        return (False, None, False)

    ttf_h = (blowup_indices[0] - start_i) + 1
    has_gap6 = any((b - a) == 6 for a, b in zip(blowup_indices, blowup_indices[1:], strict=False))
    return (True, ttf_h, has_gap6)


def conditional_risk_by_state(
    *,
    candles: list[Candle],
    pattern_bits: int,
    horizon_h: int,
    state_len: int = 6,
    train_ratio: float = 2.0 / 3.0,
) -> list[ConditionalRiskRow]:
    if state_len <= 0:
        raise ValueError('state_len must be positive')
    if horizon_h <= 0:
        raise ValueError('horizon_h must be positive')
    if not (0.0 < train_ratio < 1.0):
        raise ValueError('train_ratio must be between 0 and 1')

    # start_i is the index where you would start betting now.
    # Need state_len candles before start_i, and horizon_h candles after it.
    max_start = len(candles) - horizon_h
    if max_start <= state_len:
        raise ValueError('not enough candles for requested horizon/state_len')

    start_is = list(range(state_len, max_start))
    cut = int(len(start_is) * train_ratio)
    train_start_is = start_is[:cut]
    test_start_is = start_is[cut:]

    # For conditional-risk we only care about win/loss transitions,
    # so payout/fees are irrelevant.
    cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6)
    if cfg.pattern_len != cfg.max_steps:
        raise ValueError('internal cfg expects pattern_len == max_steps')

    def _accum(indices: list[int]):
        by_state: dict[int, dict[str, list]] = {}
        for start_i in indices:
            dirs = [candles[start_i - state_len + k].close > candles[start_i - state_len + k].open for k in range(state_len)]
            state_bits = _dirs_to_bits(dirs)

            has6, ttf, hasgap6 = _simulate_window(
                candles=candles,
                start_i=start_i,
                horizon_h=horizon_h,
                pattern_bits=pattern_bits,
                cfg=cfg,
            )

            rec = by_state.setdefault(state_bits, {'n': 0, 'n6': 0, 'ngap6': 0, 'ttf': []})
            rec['n'] += 1
            if has6:
                rec['n6'] += 1
                if ttf is not None:
                    rec['ttf'].append(ttf)
            if hasgap6:
                rec['ngap6'] += 1
        return by_state

    train = _accum(train_start_is)
    test = _accum(test_start_is)

    out: list[ConditionalRiskRow] = []
    for state_bits in range(2**state_len):
        tr = train.get(state_bits, {'n': 0, 'n6': 0, 'ngap6': 0, 'ttf': []})
        te = test.get(state_bits, {'n': 0, 'n6': 0, 'ngap6': 0, 'ttf': []})

        def _safe_rate(k: int, n: int) -> float:
            return (k / n) if n > 0 else 0.0

        def _mean(xs: list[int]) -> float:
            return (sum(xs) / len(xs)) if xs else 0.0

        row = ConditionalRiskRow(
            state_bits=state_bits,
            state_str=_bits_to_state_str(state_bits, state_len),
            train_n=int(tr['n']),
            train_p_level6=_safe_rate(int(tr['n6']), int(tr['n'])),
            train_p_gap6=_safe_rate(int(tr['ngap6']), int(tr['n'])),
            train_ttf_mean_h=_mean(tr['ttf']),
            train_ttf_p50_h=_median(tr['ttf']),
            test_n=int(te['n']),
            test_p_level6=_safe_rate(int(te['n6']), int(te['n'])),
            test_p_gap6=_safe_rate(int(te['ngap6']), int(te['n'])),
            test_ttf_mean_h=_mean(te['ttf']),
            test_ttf_p50_h=_median(te['ttf']),
        )
        out.append(row)

    return out
