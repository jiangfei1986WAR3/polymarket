from __future__ import annotations

from dataclasses import dataclass

from martingale_research.data.candles import Candle

from .conditional_risk import ConditionalRiskRow, conditional_risk_by_state
from .enumerate_patterns import MartingaleConfig, pattern_bits_to_dirs


@dataclass(frozen=True)
class AllowedStatesSelection:
    coverage_target: float
    allowed_state_bits: tuple[int, ...]
    allowed_state_strs: tuple[str, ...]
    train_coverage: float
    test_coverage: float
    train_weighted_p6: float
    test_weighted_p6: float
    train_weighted_pgap6: float
    test_weighted_pgap6: float


@dataclass(frozen=True)
class FilteredBacktestResult:
    n_hours: int
    n_entries: int
    n_bets: int
    n_wins: int
    n_losses: int
    n_blowups: int
    pnl_u: float
    max_drawdown_u: float
    equity_curve_u: tuple[float, ...] = ()


@dataclass(frozen=True)
class CoverageScanResult:
    pattern_str: str
    coverage_target: float
    allowed_states_count: int
    train_coverage: float
    test_coverage: float
    train_weighted_p6: float
    test_weighted_p6: float
    train_weighted_pgap6: float
    test_weighted_pgap6: float
    test_entries: int
    test_bets: int
    test_blowups: int
    test_pnl_u: float
    test_max_drawdown_u: float


def pattern_str_to_bits(pattern_str: str) -> int:
    s = pattern_str.strip().upper()
    if len(s) != 6 or any(ch not in {"U", "D"} for ch in s):
        raise ValueError("pattern_str must be 6 chars of U/D")

    bits = 0
    for i, ch in enumerate(s):
        if ch == "U":
            bits |= 1 << i
    return bits


def state_bits_to_str(bits: int, n: int = 6) -> str:
    out = []
    for i in range(n):
        out.append("U" if ((bits >> i) & 1) else "D")
    return "".join(out)


def _median(xs: list[int]) -> float:
    if not xs:
        return 0.0
    ys = sorted(xs)
    m = len(ys) // 2
    if len(ys) % 2 == 1:
        return float(ys[m])
    return (ys[m - 1] + ys[m]) / 2.0


def _state_bits_before(candles: list[Candle], start_i: int, state_len: int) -> int:
    bits = 0
    for offset in range(state_len):
        c = candles[start_i - state_len + offset]
        if c.close > c.open:
            bits |= 1 << offset
    return bits


def split_start_indices(
    *,
    candles: list[Candle],
    horizon_h: int,
    state_len: int = 6,
    train_ratio: float = 2.0 / 3.0,
) -> tuple[list[int], list[int]]:
    if state_len <= 0:
        raise ValueError("state_len must be positive")
    if horizon_h <= 0:
        raise ValueError("horizon_h must be positive")
    if not (0.0 < train_ratio < 1.0):
        raise ValueError("train_ratio must be between 0 and 1")

    max_start = len(candles) - horizon_h
    if max_start <= state_len:
        raise ValueError("not enough candles for requested horizon/state_len")

    start_is = list(range(state_len, max_start))
    cut = int(len(start_is) * train_ratio)
    return (start_is[:cut], start_is[cut:])


def select_allowed_states(
    rows: list[ConditionalRiskRow],
    *,
    coverage_target: float,
) -> AllowedStatesSelection:
    if not (0.0 < coverage_target <= 1.0):
        raise ValueError("coverage_target must be between 0 and 1")

    rows_with_train = [r for r in rows if r.train_n > 0]
    if not rows_with_train:
        raise ValueError("need at least one train row")

    rows_sorted = sorted(
        rows_with_train,
        key=lambda r: (
            r.train_p_level6,
            r.train_p_gap6,
            -r.train_n,
            -r.test_n,
            r.state_bits,
        ),
    )

    total_train_n = sum(r.train_n for r in rows)
    total_test_n = sum(r.test_n for r in rows)

    selected: list[ConditionalRiskRow] = []
    covered_train_n = 0
    for row in rows_sorted:
        selected.append(row)
        covered_train_n += row.train_n
        if covered_train_n / total_train_n >= coverage_target:
            break

    selected_train_n = sum(r.train_n for r in selected)
    selected_test_n = sum(r.test_n for r in selected)

    def _weighted_rate(key_n: str, key_val: str) -> float:
        total_n = sum(getattr(r, key_n) for r in selected)
        if total_n == 0:
            return 0.0
        weighted = sum(getattr(r, key_val) * getattr(r, key_n) for r in selected)
        return weighted / total_n

    return AllowedStatesSelection(
        coverage_target=coverage_target,
        allowed_state_bits=tuple(r.state_bits for r in selected),
        allowed_state_strs=tuple(r.state_str for r in selected),
        train_coverage=(selected_train_n / total_train_n) if total_train_n else 0.0,
        test_coverage=(selected_test_n / total_test_n) if total_test_n else 0.0,
        train_weighted_p6=_weighted_rate("train_n", "train_p_level6"),
        test_weighted_p6=_weighted_rate("test_n", "test_p_level6"),
        train_weighted_pgap6=_weighted_rate("train_n", "train_p_gap6"),
        test_weighted_pgap6=_weighted_rate("test_n", "test_p_gap6"),
    )


def backtest_with_allowed_states(
    *,
    candles: list[Candle],
    pattern_bits: int,
    allowed_state_bits: set[int],
    eval_start_i: int,
    eval_end_i_exclusive: int | None = None,
    cfg: MartingaleConfig,
    state_len: int = 6,
) -> FilteredBacktestResult:
    if cfg.pattern_len != cfg.max_steps:
        raise ValueError("for now, require pattern_len == max_steps")
    if state_len <= 0:
        raise ValueError("state_len must be positive")
    if eval_start_i < state_len:
        raise ValueError("eval_start_i must be >= state_len")
    if eval_end_i_exclusive is None:
        eval_end_i_exclusive = len(candles)
    if eval_end_i_exclusive <= eval_start_i:
        raise ValueError("eval_end_i_exclusive must be greater than eval_start_i")

    stakes = cfg.stakes()
    dirs = pattern_bits_to_dirs(pattern_bits, cfg.pattern_len)

    in_run = False
    level = 0

    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    equity_curve: list[float] = []

    n_hours = 0
    n_entries = 0
    n_bets = 0
    n_wins = 0
    n_losses = 0
    n_blowups = 0

    for i in range(eval_start_i, min(len(candles), eval_end_i_exclusive)):
        n_hours += 1

        if not in_run:
            state_bits = _state_bits_before(candles, i, state_len)
            if state_bits not in allowed_state_bits:
                continue
            in_run = True
            level = 0
            n_entries += 1

        c = candles[i]
        actual_up = c.close > c.open
        pred_up = dirs[level]
        stake = stakes[level]

        won = pred_up == actual_up
        pnl = (stake * cfg.payout_b * (1.0 - cfg.fee_rate)) if won else -stake

        n_bets += 1
        equity += pnl
        equity_curve.append(equity)
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)

        if won:
            n_wins += 1
            in_run = False
            level = 0
            continue

        n_losses += 1
        level += 1
        if level >= cfg.max_steps:
            n_blowups += 1
            in_run = False
            level = 0

    return FilteredBacktestResult(
        n_hours=n_hours,
        n_entries=n_entries,
        n_bets=n_bets,
        n_wins=n_wins,
        n_losses=n_losses,
        n_blowups=n_blowups,
        pnl_u=equity,
        max_drawdown_u=max_drawdown,
        equity_curve_u=tuple(equity_curve),
    )


def conditional_risk_rows_from_indices(
    *,
    candles: list[Candle],
    pattern_bits: int,
    start_indices: list[int],
    horizon_h: int,
    state_len: int = 6,
) -> list[ConditionalRiskRow]:
    if state_len <= 0:
        raise ValueError("state_len must be positive")
    if horizon_h <= 0:
        raise ValueError("horizon_h must be positive")
    if not start_indices:
        raise ValueError("start_indices must not be empty")

    cfg = MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6)
    if cfg.pattern_len != cfg.max_steps:
        raise ValueError("internal cfg expects pattern_len == max_steps")

    by_state: dict[int, dict[str, list]] = {}
    for start_i in start_indices:
        state_bits = _state_bits_before(candles, start_i, state_len)
        level = 0
        pattern_dirs = pattern_bits_to_dirs(pattern_bits, cfg.pattern_len)
        blowup_indices: list[int] = []

        end_i = min(len(candles), start_i + horizon_h)
        for i in range(start_i, end_i):
            c = candles[i]
            actual_up = c.close > c.open
            pred_up = pattern_dirs[level]
            won = pred_up == actual_up
            if won:
                level = 0
            else:
                level += 1
                if level >= cfg.max_steps:
                    blowup_indices.append(i)
                    level = 0

        rec = by_state.setdefault(state_bits, {"n": 0, "n6": 0, "ngap6": 0, "ttf": []})
        rec["n"] += 1
        if blowup_indices:
            rec["n6"] += 1
            rec["ttf"].append((blowup_indices[0] - start_i) + 1)
            if any((b - a) == 6 for a, b in zip(blowup_indices, blowup_indices[1:], strict=False)):
                rec["ngap6"] += 1

    def _safe_rate(k: int, n: int) -> float:
        return (k / n) if n > 0 else 0.0

    def _mean(xs: list[int]) -> float:
        return (sum(xs) / len(xs)) if xs else 0.0

    rows: list[ConditionalRiskRow] = []
    for state_bits in range(2**state_len):
        tr = by_state.get(state_bits, {"n": 0, "n6": 0, "ngap6": 0, "ttf": []})
        rows.append(
            ConditionalRiskRow(
                state_bits=state_bits,
                state_str=state_bits_to_str(state_bits, state_len),
                train_n=int(tr["n"]),
                train_p_level6=_safe_rate(int(tr["n6"]), int(tr["n"])),
                train_p_gap6=_safe_rate(int(tr["ngap6"]), int(tr["n"])),
                train_ttf_mean_h=_mean(tr["ttf"]),
                train_ttf_p50_h=_median(tr["ttf"]),
                test_n=0,
                test_p_level6=0.0,
                test_p_gap6=0.0,
                test_ttf_mean_h=0.0,
                test_ttf_p50_h=0.0,
            )
        )

    return rows


def scan_coverages(
    *,
    candles: list[Candle],
    pattern_str: str,
    coverages: list[float],
    horizon_h: int = 72,
    train_ratio: float = 0.75,
    state_len: int = 6,
    cfg: MartingaleConfig | None = None,
) -> tuple[list[ConditionalRiskRow], list[CoverageScanResult], FilteredBacktestResult]:
    pattern_bits = pattern_str_to_bits(pattern_str)
    rows = conditional_risk_by_state(
        candles=candles,
        pattern_bits=pattern_bits,
        horizon_h=horizon_h,
        state_len=state_len,
        train_ratio=train_ratio,
    )

    _, test_start_is = split_start_indices(
        candles=candles,
        horizon_h=horizon_h,
        state_len=state_len,
        train_ratio=train_ratio,
    )
    if not test_start_is:
        raise ValueError("test split is empty")

    eval_start_i = test_start_is[0]
    cfg = cfg or MartingaleConfig(pattern_len=6, base_stake_u=2.0, max_steps=6, payout_b=1.0, fee_rate=0.0)
    baseline = backtest_with_allowed_states(
        candles=candles,
        pattern_bits=pattern_bits,
        allowed_state_bits=set(range(2**state_len)),
        eval_start_i=eval_start_i,
        cfg=cfg,
        state_len=state_len,
    )

    scan_rows: list[CoverageScanResult] = []
    for coverage in coverages:
        selected = select_allowed_states(rows, coverage_target=coverage)
        bt = backtest_with_allowed_states(
            candles=candles,
            pattern_bits=pattern_bits,
            allowed_state_bits=set(selected.allowed_state_bits),
            eval_start_i=eval_start_i,
            cfg=cfg,
            state_len=state_len,
        )
        scan_rows.append(
            CoverageScanResult(
                pattern_str=pattern_str,
                coverage_target=coverage,
                allowed_states_count=len(selected.allowed_state_bits),
                train_coverage=selected.train_coverage,
                test_coverage=selected.test_coverage,
                train_weighted_p6=selected.train_weighted_p6,
                test_weighted_p6=selected.test_weighted_p6,
                train_weighted_pgap6=selected.train_weighted_pgap6,
                test_weighted_pgap6=selected.test_weighted_pgap6,
                test_entries=bt.n_entries,
                test_bets=bt.n_bets,
                test_blowups=bt.n_blowups,
                test_pnl_u=bt.pnl_u,
                test_max_drawdown_u=bt.max_drawdown_u,
            )
        )

    return (rows, scan_rows, baseline)
