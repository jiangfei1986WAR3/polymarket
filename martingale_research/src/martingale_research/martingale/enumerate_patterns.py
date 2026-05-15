from __future__ import annotations

from dataclasses import dataclass
from martingale_research.data.candles import Candle


@dataclass(frozen=True)
class MartingaleConfig:
    pattern_len: int = 6
    base_stake_u: float = 2.0
    max_steps: int = 6
    payout_b: float = 1.0
    fee_rate: float = 0.0

    def stakes(self) -> list[float]:
        # 2,4,8,...
        return [self.base_stake_u * (2**i) for i in range(self.max_steps)]
@dataclass(frozen=True)
class PatternBacktestResult:
    pattern_bits: int
    n_bets: int
    n_wins: int
    n_losses: int
    pnl_u: float
    max_drawdown_u: float
    max_level_reached: int
    n_level6_losses: int
    level6_loss_gaps: list[int]


def _bit_to_dir_up(bit: int) -> bool:
    # 1 => up, 0 => down
    return bit == 1


def pattern_bits_to_dirs(pattern_bits: int, n: int) -> list[bool]:
    """Decode pattern bits to per-step directions.

    Step1 is the least-significant bit.
    """
    out: list[bool] = []
    for i in range(n):
        out.append(_bit_to_dir_up((pattern_bits >> i) & 1))
    return out


def enumerate_pattern_bits(n: int) -> list[int]:
    if n <= 0:
        raise ValueError('pattern length must be positive')
    return list(range(2**n))


def _pnl_for_bet(
    *,
    stake_u: float,
    won: bool,
    payout_b: float,
    fee_rate: float,
) -> float:
    # If you bet stake S at b=1.0 payout:
    # win => +S*b, lose => -S.
    # Then apply a simple proportional fee on gross winnings.
    if won:
        gross = stake_u * payout_b
        fee = gross * fee_rate
        return gross - fee
    return -stake_u


def backtest_pattern(
    *,
    candles: list[Candle],
    pattern_bits: int,
    cfg: MartingaleConfig,
) -> PatternBacktestResult:
    if cfg.pattern_len != cfg.max_steps:
        raise ValueError('for now, require pattern_len == max_steps')
    if len(candles) < 2:
        raise ValueError('need candles')

    pattern = pattern_bits_to_dirs(pattern_bits, cfg.pattern_len)
    stakes = cfg.stakes()

    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0

    level = 0  # 0..max_steps-1
    n_bets = 0
    n_wins = 0
    n_losses = 0
    max_level_reached = 1

    level6_loss_indices: list[int] = []

    for i, c in enumerate(candles):
        # Define outcome for this hour.
        # If close == open, treat as down (y=0) for determinism.
        actual_up = c.close > c.open

        pred_up = pattern[level]

        stake = stakes[level]
        won = pred_up == actual_up
        pnl = _pnl_for_bet(stake_u=stake, won=won, payout_b=cfg.payout_b, fee_rate=cfg.fee_rate)

        n_bets += 1
        if won:
            n_wins += 1
            level = 0
        else:
            n_losses += 1
            level += 1
            if level >= cfg.max_steps:
                # Blew through all 6 steps (6 consecutive losses).
                level6_loss_indices.append(i)
                level = 0

        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)

        max_level_reached = max(max_level_reached, level + 1)

    gaps: list[int] = []
    for a, b in zip(level6_loss_indices, level6_loss_indices[1:], strict=False):
        gaps.append(b - a)

    return PatternBacktestResult(
        pattern_bits=pattern_bits,
        n_bets=n_bets,
        n_wins=n_wins,
        n_losses=n_losses,
        pnl_u=equity,
        max_drawdown_u=max_drawdown,
        max_level_reached=max_level_reached,
        n_level6_losses=len(level6_loss_indices),
        level6_loss_gaps=gaps,
    )


def backtest_all_patterns(*, candles: list[Candle], cfg: MartingaleConfig) -> list[PatternBacktestResult]:
    out: list[PatternBacktestResult] = []
    for bits in enumerate_pattern_bits(cfg.pattern_len):
        out.append(backtest_pattern(candles=candles, pattern_bits=bits, cfg=cfg))
    return out
