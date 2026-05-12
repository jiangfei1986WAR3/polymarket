from __future__ import annotations

import random
from pathlib import Path

import numpy as np

from ..backtest.sample_builder import build_sample
from ..data.binance_csv import load_binance_klines_csv
from ..data.quality_check import quality_check_1h
from ..kronos.cache import load_paths_from_cache, _sample_key
from ..matching.selector import q_from_paths_pred_close_gt_open, random_k, topk_by_known_path_error


def _log_loss(probs, labels, eps=1e-12):
    p = np.asarray(probs, dtype=float)
    y = np.asarray(labels, dtype=float)
    p = np.clip(p, eps, 1.0 - eps)
    return float(-np.mean(y * np.log(p) + (1.0 - y) * np.log(1.0 - p)))


def _ece(probs, labels, bins):
    p = np.asarray(probs, dtype=float)
    y = np.asarray(labels, dtype=float)

    edges = [0.0] + list(bins)
    if edges[-1] < 1.0:
        edges.append(1.0)

    tot = len(p)
    ece = 0.0
    table = []

    for i in range(len(edges) - 1):
        lo = edges[i]
        hi = edges[i + 1]
        if i < len(edges) - 2:
            m = (p >= lo) & (p < hi)
        else:
            m = (p >= lo) & (p <= hi)
        n = int(np.sum(m))
        if n == 0:
            table.append((lo, hi, 0, None, None))
            continue
        p_mean = float(np.mean(p[m]))
        y_mean = float(np.mean(y[m]))
        ece += (n / tot) * abs(p_mean - y_mean)
        table.append((lo, hi, n, p_mean, y_mean))

    return float(ece), table


def _bootstrap_ci(probs, labels, metric_fn, iters=1000, seed=0):
    rng = np.random.default_rng(seed)
    p = np.asarray(probs)
    y = np.asarray(labels)
    n = len(p)

    vals = np.empty(iters, dtype=float)
    for i in range(iters):
        idx = rng.integers(0, n, size=n)
        vals[i] = metric_fn(p[idx], y[idx])

    vals.sort()
    lo = float(vals[int(0.025 * iters)])
    hi = float(vals[int(0.975 * iters)])
    return float(np.mean(vals)), lo, hi


def build_report_from_cache(
    *,
    csv_path: str,
    cache_dir: str,
    context: int,
    known: int,
    horizon: int,
    n_paths: int,
    k: int,
    time_decay: float,
    start_i: int,
    end_i: int,
    randomk_repeats: int,
    seed: int,
    extra: dict,
    out_md: str,
):
    candles = load_binance_klines_csv(csv_path)
    qr = quality_check_1h(candles)
    if qr.duplicates or qr.missing or qr.invalid_ohlc:
        raise ValueError('quality_check failed: ' + str(qr))

    if end_i <= 0:
        end_i = len(candles) - 1

    qs_all = []
    qs_topk = []
    qs_randk = []
    ys = []

    rng = random.Random(seed)

    for i in range(start_i, end_i + 1):
        s = build_sample(candles, i=i, context_length=context, known_path_length=known)
        key = _sample_key(s.model_input, horizon, n_paths, extra)
        paths = load_paths_from_cache(cache_dir, key)
        if paths is None:
            raise FileNotFoundError('cache miss for i=' + str(i) + ' key=' + key)

        target_idx = horizon - 1

        q_all = q_from_paths_pred_close_gt_open(paths, target_idx=target_idx)
        best = topk_by_known_path_error(
            paths,
            true_known=s.known_true,
            known_path_length=known,
            k=k,
            time_decay=time_decay,
        )
        q_top = q_from_paths_pred_close_gt_open(best, target_idx=target_idx)

        q_r_sum = 0.0
        for _ in range(randomk_repeats):
            sub = random_k(paths, k=k, rng=rng)
            q_r_sum += q_from_paths_pred_close_gt_open(sub, target_idx=target_idx)
        q_r = q_r_sum / randomk_repeats

        y = 1 if s.target_true.close > s.target_true.open else 0

        qs_all.append(q_all)
        qs_topk.append(q_top)
        qs_randk.append(q_r)
        ys.append(y)

    def brier(p, y):
        p = np.asarray(p, dtype=float)
        y = np.asarray(y, dtype=float)
        return float(np.mean((p - y) ** 2))

    def acc(p, y, thr=0.5):
        p = np.asarray(p, dtype=float)
        y = np.asarray(y, dtype=int)
        pred = (p > thr).astype(int)
        return float(np.mean(pred == y))

    bins = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.0]

    def summarize(name, p):
        ece_val, table = _ece(p, ys, bins)
        mean_b, lo_b, hi_b = _bootstrap_ci(p, ys, lambda pp, yy: brier(pp, yy), iters=1000, seed=42)
        mean_a, lo_a, hi_a = _bootstrap_ci(p, ys, lambda pp, yy: acc(pp, yy), iters=1000, seed=43)
        return {
            'name': name,
            'n': len(ys),
            'brier': brier(p, ys),
            'logloss': _log_loss(p, ys),
            'acc': acc(p, ys),
            'ece': ece_val,
            'brier_ci': (lo_b, hi_b),
            'acc_ci': (lo_a, hi_a),
            'cal_table': table,
        }

    s_all = summarize('all', qs_all)
    s_top = summarize('topk', qs_topk)
    s_rnd = summarize('randomk', qs_randk)

    lines = []
    lines.append('# V1 Report\n')
    lines.append('\n')
    lines.append('Data CSV: ' + csv_path + '\n')
    lines.append('Cache dir: ' + cache_dir + '\n')
    lines.append('Samples: ' + str(len(ys)) + '\n')
    lines.append('\n')

    def add_block(s):
        lines.append('## ' + s['name'] + '\n')
        lines.append('- brier: ' + format(s['brier'], '.6f') + ' (95% CI ' + format(s['brier_ci'][0], '.6f') + ', ' + format(s['brier_ci'][1], '.6f') + ')\n')
        lines.append('- logloss: ' + format(s['logloss'], '.6f') + '\n')
        lines.append('- acc: ' + format(s['acc'], '.4f') + ' (95% CI ' + format(s['acc_ci'][0], '.4f') + ', ' + format(s['acc_ci'][1], '.4f') + ')\n')
        lines.append('- ece: ' + format(s['ece'], '.6f') + '\n')
        lines.append('\n')
        lines.append('Calibration bins (lo, hi, n, p_mean, y_mean):\n')
        for lo, hi, n, p_mean, y_mean in s['cal_table']:
            lines.append('- ' + str(lo) + ' ' + str(hi) + ' n=' + str(n) + ' p=' + ('' if p_mean is None else format(p_mean, '.4f')) + ' y=' + ('' if y_mean is None else format(y_mean, '.4f')) + '\n')
        lines.append('\n')

    add_block(s_all)
    add_block(s_top)
    add_block(s_rnd)

    out_path = Path(out_md)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(''.join(lines), encoding='utf-8')
    return out_path
