from __future__ import annotations

import argparse

from .data.binance_csv import load_binance_klines_csv
from .data.binance_downloader import download_binance_klines_1h
from .data.quality_check import quality_check_1h
from .martingale import (
    MartingaleConfig,
    StateMapping,
    backtest_all_patterns,
    backtest_state_driven_martingale,
    conditional_risk_by_state,
    pattern_bits_to_dirs,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog='martingale-research')

    data = p.add_argument_group('data')
    data.add_argument('--csv', default='', help='Binance 1H candle CSV path')
    data.add_argument('--download-binance', action='store_true', help='Download from Binance API into --csv path')
    data.add_argument('--binance-base-url', default='https://api.binance.com')
    data.add_argument('--symbol', default='BTCUSDT')
    data.add_argument('--days', type=int, default=30)

    mg = p.add_argument_group('martingale')
    mg.add_argument('--martingale-enum', action='store_true', help='Enumerate all 2^6 up/down patterns')
    mg.add_argument('--pattern-len', type=int, default=6)
    mg.add_argument('--base-stake', type=float, default=2.0)
    mg.add_argument('--max-steps', type=int, default=6)
    mg.add_argument('--payout-b', type=float, default=1.0)
    mg.add_argument('--fee-rate', type=float, default=0.0)
    mg.add_argument('--topn', type=int, default=10, help='Show top N patterns by PnL')
    mg.add_argument('--conditional-risk', action='store_true', help='Compute conditional risk by last-6-candles state')
    mg.add_argument('--risk-horizon', type=int, default=72, help='Conditional risk horizon in hours')
    mg.add_argument('--train-ratio', type=float, default=(2.0 / 3.0), help='Train split ratio for conditional risk')
    mg.add_argument('--risk-pattern', default='UUUUUU', help='Pattern for conditional risk (e.g. UUDDUD), len must be 6')
    mg.add_argument('--state-driven', action='store_true', help='Use last-6-candles state as the 6-step pattern each run')
    mg.add_argument('--state-mapping', choices=[m.value for m in StateMapping], default=StateMapping.FORWARD.value)

    return p.parse_args()


def main() -> None:
    args = _parse_args()

    if args.download_binance:
        if not args.csv:
            args.csv = f'martingale_research/data/raw/binance/{args.symbol}_1h_{args.days}d.csv'
        res = download_binance_klines_1h(
            symbol=args.symbol,
            days=args.days,
            out_csv=args.csv,
            base_url=args.binance_base_url,
        )
        print('downloaded', res.n_candles, 'candles to', str(res.out_csv))

        if not args.martingale_enum and not args.conditional_risk and not args.state_driven:
            return

    if not args.csv:
        raise SystemExit('need --csv or --download-binance')

    candles = load_binance_klines_csv(args.csv)
    qr = quality_check_1h(candles)
    if qr.duplicates or qr.missing or qr.invalid_ohlc:
        raise SystemExit('quality_check failed: ' + str(qr))

    if args.martingale_enum:
        cfg = MartingaleConfig(
            pattern_len=args.pattern_len,
            base_stake_u=args.base_stake,
            max_steps=args.max_steps,
            payout_b=args.payout_b,
            fee_rate=args.fee_rate,
        )
        res = backtest_all_patterns(candles=candles, cfg=cfg)

        def _pattern_str(bits: int) -> str:
            dirs = pattern_bits_to_dirs(bits, cfg.pattern_len)
            return ''.join('U' if d else 'D' for d in dirs)

        def _gap_stats(gaps: list[int]) -> tuple[str, str, str]:
            if not gaps:
                return ('', '', '')
            mn = min(gaps)
            mx = max(gaps)
            avg = sum(gaps) / len(gaps)
            return (str(mn), f'{avg:.2f}', str(mx))

        res_sorted = sorted(res, key=lambda r: (-r.pnl_u, r.max_drawdown_u, r.n_level6_losses))
        print('martingale-enum n_patterns=', len(res_sorted), 'n_candles=', len(candles))
        print('config', cfg)

        print('\nTOP BY PNL')
        print('pattern\tpnl_u\tmax_dd_u\tlevel6\tgap_min\tgap_avg\tgap_max')
        for r in res_sorted[: max(0, args.topn)]:
            gmn, gavg, gmx = _gap_stats(r.level6_loss_gaps)
            print(
                _pattern_str(r.pattern_bits),
                f'{r.pnl_u:.4f}',
                f'{r.max_drawdown_u:.4f}',
                r.n_level6_losses,
                gmn,
                gavg,
                gmx,
                sep='\t',
            )

        safe_sorted = sorted(res, key=lambda r: (r.n_level6_losses, -r.pnl_u, r.max_drawdown_u))
        print('\nTOP BY FEWEST 6-LOSS EVENTS')
        print('pattern\tlevel6\tpnl_u\tmax_dd_u\tgap_min\tgap_avg\tgap_max')
        for r in safe_sorted[: max(0, args.topn)]:
            gmn, gavg, gmx = _gap_stats(r.level6_loss_gaps)
            print(
                _pattern_str(r.pattern_bits),
                r.n_level6_losses,
                f'{r.pnl_u:.4f}',
                f'{r.max_drawdown_u:.4f}',
                gmn,
                gavg,
                gmx,
                sep='\t',
            )

        return

    if args.conditional_risk:
        cfg = MartingaleConfig(
            pattern_len=6,
            base_stake_u=args.base_stake,
            max_steps=6,
            payout_b=1.0,
            fee_rate=0.0,
        )

        s = (args.risk_pattern or '').strip().upper()
        if len(s) != 6 or any(ch not in {'U', 'D'} for ch in s):
            raise SystemExit('--risk-pattern must be 6 chars of U/D, e.g. UUDDUD')

        pattern_bits = 0
        for i, ch in enumerate(s):
            if ch == 'U':
                pattern_bits |= 1 << i

        rows = conditional_risk_by_state(
            candles=candles,
            pattern_bits=pattern_bits,
            horizon_h=args.risk_horizon,
            state_len=6,
            train_ratio=args.train_ratio,
        )

        train_n = sum(r.train_n for r in rows)
        test_n = sum(r.test_n for r in rows)
        train_p6 = (sum(r.train_p_level6 * r.train_n for r in rows) / train_n) if train_n else 0.0
        test_p6 = (sum(r.test_p_level6 * r.test_n for r in rows) / test_n) if test_n else 0.0
        train_pgap6 = (sum(r.train_p_gap6 * r.train_n for r in rows) / train_n) if train_n else 0.0
        test_pgap6 = (sum(r.test_p_gap6 * r.test_n for r in rows) / test_n) if test_n else 0.0

        print('conditional-risk', f'pattern={s}', 'horizon_h=', args.risk_horizon, 'train_ratio=', args.train_ratio)
        print('baseline', f'train_p6={train_p6:.4f}', f'test_p6={test_p6:.4f}', f'train_pgap6={train_pgap6:.4f}', f'test_pgap6={test_pgap6:.4f}')
        print('state\ttrain_n\ttrain_p6\ttrain_pgap6\ttrain_ttf_mean\ttrain_ttf_p50\ttest_n\ttest_p6\ttest_pgap6\ttest_ttf_mean\ttest_ttf_p50')
        for r in rows:
            print(
                r.state_str,
                r.train_n,
                f'{r.train_p_level6:.4f}',
                f'{r.train_p_gap6:.4f}',
                f'{r.train_ttf_mean_h:.2f}',
                f'{r.train_ttf_p50_h:.2f}',
                r.test_n,
                f'{r.test_p_level6:.4f}',
                f'{r.test_p_gap6:.4f}',
                f'{r.test_ttf_mean_h:.2f}',
                f'{r.test_ttf_p50_h:.2f}',
                sep='\t',
            )
        return

    if args.state_driven:
        cfg = MartingaleConfig(
            pattern_len=6,
            base_stake_u=args.base_stake,
            max_steps=6,
            payout_b=args.payout_b,
            fee_rate=args.fee_rate,
        )
        res = backtest_state_driven_martingale(
            candles=candles,
            cfg=cfg,
            mapping=StateMapping(args.state_mapping),
        )
        print('state-driven', 'mapping=', args.state_mapping, 'config', cfg)
        print('hours', res.n_hours_considered, 'runs', res.n_runs, 'bets', res.n_bets, 'wins', res.n_wins, 'blowups', res.n_blowups)
        print('pnl_u', round(res.pnl_u, 4), 'avg_run_len_h', round(res.avg_run_len_h, 4))
        return

    raise SystemExit('need one action: --martingale-enum, --conditional-risk, --state-driven, or --download-binance')


if __name__ == '__main__':
    main()
