from __future__ import annotations

import argparse
import random

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
    p = argparse.ArgumentParser(prog='kronos-v1')

    data = p.add_argument_group('data')
    data.add_argument('--csv', default='', help='Binance 1H candle CSV path')
    data.add_argument('--download-binance', action='store_true', help='Download from Binance API into --csv path')
    data.add_argument('--binance-base-url', default='https://api.binance.com')
    data.add_argument('--symbol', default='BTCUSDT')
    data.add_argument('--days', type=int, default=30)

    bt = p.add_argument_group('backtest')
    bt.add_argument('--context', type=int, default=512)
    bt.add_argument('--known', type=int, default=11)
    bt.add_argument('--horizon', type=int, default=12)
    bt.add_argument('--n-paths', type=int, default=50)
    bt.add_argument('--k', type=int, default=10, help='TopK for filtering')
    bt.add_argument('--time-decay', type=float, default=1.0)
    bt.add_argument('--start-i', type=int, default=600)
    bt.add_argument('--end-i', type=int, default=0, help='0 means use last available')

    kronos = p.add_argument_group('kronos')
    kronos.add_argument('--kronos-mode', choices=['mock', 'http', 'local'], default='local')
    kronos.add_argument('--kronos-url', default='http://127.0.0.1:8000')
    kronos.add_argument('--kronos-repo-dir', default='kronos_external/Kronos')
    kronos.add_argument('--kronos-tokenizer-dir', default='kronos_external/hf_cache/Kronos-Tokenizer-base')
    kronos.add_argument('--kronos-model-dir', default='kronos_external/hf_cache/Kronos-base')
    kronos.add_argument('--device', default='cuda:0')
    kronos.add_argument('--T', type=float, default=1.0)
    kronos.add_argument('--top-p', type=float, default=0.9)
    kronos.add_argument('--top-k', type=int, default=0)

    cache = p.add_argument_group('cache')
    cache.add_argument('--cache-dir', default='kronos_v1_backtest/data/cache/kronos_predictions')
    cache.add_argument('--no-cache', action='store_true')

    misc = p.add_argument_group('misc')
    misc.add_argument('--randomk-repeats', type=int, default=20)
    misc.add_argument('--seed', type=int, default=0)

    mg = p.add_argument_group('martingale')
    mg.add_argument('--martingale-enum', action='store_true', help='Enumerate all 2^6 up/down patterns')
    mg.add_argument('--pattern-len', type=int, default=6)
    mg.add_argument('--base-stake', type=float, default=2.0)
    mg.add_argument('--max-steps', type=int, default=6)
    mg.add_argument('--payout-b', type=float, default=1.0)
    mg.add_argument('--fee-rate', type=float, default=0.0)
    # (Reserved) allow-flat removed: classic martingale is U/D only.
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
            args.csv = f'kronos_v1_backtest/data/raw/binance/{args.symbol}_1h_{args.days}d.csv'
        res = download_binance_klines_1h(
            symbol=args.symbol,
            days=args.days,
            out_csv=args.csv,
            base_url=args.binance_base_url,
        )
        print('downloaded', res.n_candles, 'candles to', str(res.out_csv))

        # If user only wanted to download data, stop here.
        if not args.martingale_enum and not args.conditional_risk:
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

        # Sort by pnl desc, then max drawdown asc.
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

        # Also show most "safe" by fewest 6-loss events, tie-breaker by pnl.
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
        # Conditional risk is defined for classic 6-step martingale (no flat).
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

        # Pattern encoding: step1 is LSB.
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

        # Baseline (weighted by occurrences).
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

    # Heavy deps (pandas/torch) are imported lazily so that pure-math
    # tooling like --martingale-enum can run in minimal environments.
    from .backtest.sample_builder import build_sample
    from .evaluation.metrics import accuracy_from_probs, brier_score
    from .kronos.cache import cached_predict_paths
    from .kronos.factory import make_kronos_client
    from .matching.selector import q_from_paths_pred_close_gt_open, random_k, topk_by_known_path_error

    client = make_kronos_client(
        args.kronos_mode,
        seed=args.seed,
        http_url=args.kronos_url,
        kronos_repo_dir=args.kronos_repo_dir,
        tokenizer_dir=args.kronos_tokenizer_dir,
        model_dir=args.kronos_model_dir,
        device=args.device,
    )

    start_i = args.start_i
    end_i = args.end_i if args.end_i > 0 else len(candles) - 1

    q_all_list = []
    q_topk_list = []
    q_randk_list = []
    y_list = []

    rng = random.Random(args.seed)

    for i in range(start_i, end_i + 1):
        s = build_sample(candles, i=i, context_length=args.context, known_path_length=args.known)

        def _predict():
            return client.predict_paths(
                s.model_input,
                horizon=args.horizon,
                n_paths=args.n_paths,
                T=args.T,
                top_p=args.top_p,
                top_k=args.top_k,
                verbose=False,
            )

        if args.no_cache:
            paths = _predict()
        else:
            extra = {
                'mode': args.kronos_mode,
                'T': args.T,
                'top_p': args.top_p,
                'top_k': args.top_k,
                'device': args.device,
                'tokenizer': args.kronos_tokenizer_dir,
                'model': args.kronos_model_dir,
            }
            paths = cached_predict_paths(
                cache_dir=args.cache_dir,
                model_input=s.model_input,
                horizon=args.horizon,
                n_paths=args.n_paths,
                extra=extra,
                predict_fn=_predict,
            )

        target_idx = args.horizon - 1

        q_all = q_from_paths_pred_close_gt_open(paths, target_idx=target_idx)
        best = topk_by_known_path_error(
            paths,
            true_known=s.known_true,
            known_path_length=args.known,
            k=args.k,
            time_decay=args.time_decay,
        )
        q_topk = q_from_paths_pred_close_gt_open(best, target_idx=target_idx)

        q_randk_sum = 0.0
        for _ in range(args.randomk_repeats):
            sub = random_k(paths, k=args.k, rng=rng)
            q_randk_sum += q_from_paths_pred_close_gt_open(sub, target_idx=target_idx)
        q_randk = q_randk_sum / args.randomk_repeats

        y = 1 if s.target_true.close > s.target_true.open else 0

        q_all_list.append(q_all)
        q_topk_list.append(q_topk)
        q_randk_list.append(q_randk)
        y_list.append(y)

    def _summ(name: str, qs):
        bs = brier_score(qs, y_list)
        acc = accuracy_from_probs(qs, y_list)
        print(name, 'n=', len(qs), 'brier=', round(bs, 6), 'acc=', round(acc, 4))

    _summ('all', q_all_list)
    _summ('topk', q_topk_list)
    _summ('randomk', q_randk_list)


if __name__ == '__main__':
    main()
