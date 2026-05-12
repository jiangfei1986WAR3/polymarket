from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from kronos_v1_backtest.data.candles import Candle

from .enumerate_patterns import MartingaleConfig


def _pnl_for_bet(*, stake_u: float, won: bool, payout_b: float, fee_rate: float) -> float:
    if won:
        gross = stake_u * payout_b
        return gross - (gross * fee_rate)
    return -stake_u


class StateMapping(str, Enum):
    # When starting a run at hour t, we look at candles t-6..t-1.
    #
    # FORWARD: step1 uses the oldest candle direction (t-6), step6 uses newest (t-1).
    # REVERSE: step1 uses the newest candle direction (t-1), step6 uses oldest (t-6).
    FORWARD = 'forward'
    REVERSE = 'reverse'


@dataclass(frozen=True)
class StateDrivenResult:
    n_hours_considered: int
    n_runs: int
    n_bets: int
    n_wins: int
    n_blowups: int
    pnl_u: float
    avg_run_len_h: float


def _last6_pattern_bits(*, candles: list[Candle], start_i: int, mapping: StateMapping) -> int:
    """Build a 6-bit pattern from the last 6 candles before start_i.

    Bit i corresponds to martingale step i+1.
    """

    if start_i < 6:
        raise ValueError('start_i must be >= 6')

    bits = 0
    if mapping == StateMapping.FORWARD:
        # step1 = t-6 (oldest)
        idxs = list(range(start_i - 6, start_i))
    elif mapping == StateMapping.REVERSE:
        # step1 = t-1 (newest)
        idxs = list(range(start_i - 1, start_i - 7, -1))
    else:
        raise ValueError('unknown mapping')

    for step, j in enumerate(idxs):
        up = candles[j].close > candles[j].open
        if up:
            bits |= 1 << step
    return bits


def backtest_state_driven_martingale(
    *,
    candles: list[Candle],
    cfg: MartingaleConfig,
    mapping: StateMapping = StateMapping.FORWARD,
) -> StateDrivenResult:
    """State-driven martingale.

    Each time a run starts (flat -> first bet), derive the 6-step pattern from
    the last 6 candle directions at that moment.

    Then follow classic 6-step martingale until win or blowup.
    """

    if cfg.pattern_len != 6 or cfg.max_steps != 6:
        raise ValueError('state-driven mode currently supports 6-step only')
    if len(candles) < 6:
        raise ValueError('need at least 6 candles')

    stakes = cfg.stakes()
    equity = 0.0

    n_hours = 0
    n_runs = 0
    n_bets = 0
    n_wins = 0
    n_blowups = 0
    total_run_len = 0

    in_run = False
    level = 0
    run_len = 0
    pattern_bits = 0

    for i in range(6, len(candles)):
        n_hours += 1

        if not in_run:
            pattern_bits = _last6_pattern_bits(candles=candles, start_i=i, mapping=mapping)
            in_run = True
            level = 0
            run_len = 0
            n_runs += 1

        # Bet this hour.
        c = candles[i]
        actual_up = c.close > c.open
        pred_up = ((pattern_bits >> level) & 1) == 1
        stake = stakes[level]
        won = pred_up == actual_up

        n_bets += 1
        run_len += 1

        if won:
            n_wins += 1
            equity += _pnl_for_bet(stake_u=stake, won=True, payout_b=cfg.payout_b, fee_rate=cfg.fee_rate)
            total_run_len += run_len
            in_run = False
            level = 0
            run_len = 0
        else:
            equity += _pnl_for_bet(stake_u=stake, won=False, payout_b=cfg.payout_b, fee_rate=cfg.fee_rate)
            level += 1
            if level >= cfg.max_steps:
                n_blowups += 1
                total_run_len += run_len
                in_run = False
                level = 0
                run_len = 0

    avg_len = (total_run_len / n_runs) if n_runs else 0.0
    return StateDrivenResult(
        n_hours_considered=n_hours,
        n_runs=n_runs,
        n_bets=n_bets,
        n_wins=n_wins,
        n_blowups=n_blowups,
        pnl_u=equity,
        avg_run_len_h=avg_len,
    )
