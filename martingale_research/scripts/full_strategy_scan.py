from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def _enumerate_binary_patterns(pattern_len: int) -> list[str]:
    patterns: list[str] = []
    for bits in range(2**pattern_len):
        pattern = "".join("U" if ((bits >> i) & 1) == 1 else "D" for i in range(pattern_len))
        patterns.append(pattern)
    return patterns


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.data.binance_csv import load_binance_klines_csv  # noqa: E402
from martingale_research.martingale import (  # noqa: E402
    MartingaleConfig,
    conditional_risk_rows_from_indices,
    pattern_str_to_bits,
    run_walk_forward,
    scan_coverages,
    select_allowed_states,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="full-strategy-scan")
    default_patterns = ",".join(_enumerate_binary_patterns(6))
    p.add_argument(
        "--csv",
        default=str(ROOT / "data" / "raw" / "binance" / "BTCUSDT_1h_365d.csv"),
        help="Path to Binance 1H CSV",
    )
    p.add_argument(
        "--patterns",
        default=default_patterns,
        help="Comma-separated list of 6-char U/D patterns",
    )
    p.add_argument(
        "--coverages",
        default="0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9",
        help="Comma-separated target coverages",
    )
    p.add_argument("--risk-horizon", type=int, default=72)
    p.add_argument("--train-ratio", type=float, default=0.75)
    p.add_argument("--train-window-days", type=int, default=334)
    p.add_argument("--step-days", type=int, default=7)
    p.add_argument("--base-stake", type=float, default=2.0)
    p.add_argument(
        "--version-prefix",
        default="auto",
        help="Stable prefix for exported candidate directories",
    )
    p.add_argument(
        "--out-dir",
        default=str(ROOT / "strategy_outputs"),
        help="Directory for exported strategy files",
    )
    return p.parse_args()


def _emit_progress(**payload: object) -> None:
    print(json.dumps({"type": "progress", **payload}, ensure_ascii=False), flush=True)


def _emit_result(summary: dict[str, object]) -> None:
    print(json.dumps({"type": "result", "summary": summary}, ensure_ascii=False), flush=True)


def _best_row(rows):
    return min(
        rows,
        key=lambda r: (
            r.test_blowups,
            -r.test_pnl_u,
            r.test_max_drawdown_u,
            r.test_weighted_p6,
            abs(r.coverage_target - 0.6),
        ),
    )


def _score_candidate(candidate: dict[str, object]) -> float:
    drawdown_u = float(candidate.get("max_cumulative_drawdown_u", candidate["max_step_drawdown_u"]))
    return float(
        round(
            float(candidate["total_pnl_u"])
            - float(candidate["total_blowups"]) * 18
            - drawdown_u * 0.35
            - abs(float(candidate["coverage_target"]) - 0.6) * 1000
            + float(candidate["profitable_steps"]) * 1.5,
            4,
        )
    )


def _sanitize_pattern(pattern: str) -> str:
    return "".join(ch for ch in pattern.upper() if ch in {"U", "D"})


def _build_latest_allowed_states(
    *,
    candles,
    pattern_str: str,
    coverage: float,
    horizon_h: int,
    train_window_h: int,
):
    pattern_bits = pattern_str_to_bits(pattern_str)
    train_end_i_exclusive = len(candles)
    train_start_i = max(0, train_end_i_exclusive - train_window_h)
    start_i_min = max(train_start_i + 6, 6)
    start_i_max_exclusive = train_end_i_exclusive - horizon_h
    start_indices = list(range(start_i_min, start_i_max_exclusive))
    rows = conditional_risk_rows_from_indices(
        candles=candles,
        pattern_bits=pattern_bits,
        start_indices=start_indices,
        horizon_h=horizon_h,
        state_len=6,
    )
    return select_allowed_states(rows, coverage_target=coverage)


def _effective_train_window_days(candle_count: int, train_window_days: int, risk_horizon: int, step_days: int) -> int:
    max_train_window_days = max(
        30,
        (candle_count - 6 - risk_horizon - step_days * 24) // 24,
    )
    if candle_count <= 0:
        return train_window_days
    return max(30, min(train_window_days, max_train_window_days))


def _remove_previous_exports(out_root: Path, version_prefix: str) -> None:
    for child in out_root.iterdir():
        if child.is_dir() and child.name.startswith(f"{version_prefix}-"):
            shutil.rmtree(child, ignore_errors=True)
    summary_file = out_root / f"{version_prefix}-scan-summary.json"
    if summary_file.exists():
        summary_file.unlink()


def _write_bundle(
    *,
    out_root: Path,
    version: str,
    generated_at_utc: str,
    pattern: str,
    coverage: float,
    risk_horizon: int,
    train_window_days: int,
    step_days: int,
    base_stake: float,
    latest_selection,
    walk_forward,
) -> Path:
    out_dir = out_root / version
    out_dir.mkdir(parents=True, exist_ok=True)

    strategy_config = {
        "version": version,
        "generated_at_utc": generated_at_utc,
        "pattern": pattern,
        "coverage_target": coverage,
        "risk_horizon_h": risk_horizon,
        "train_window_days": train_window_days,
        "step_days": step_days,
        "base_stake_u": base_stake,
        "max_steps": 6,
        "allowed_states_count": len(latest_selection.allowed_state_strs),
    }
    allowed_states_json = {
        "version": version,
        "pattern": pattern,
        "coverage_target": coverage,
        "allowed_states": list(latest_selection.allowed_state_strs),
    }
    walk_forward_summary = {
        "version": version,
        "pattern": walk_forward.pattern_str,
        "coverage_target": walk_forward.coverage_target,
        "train_window_h": walk_forward.train_window_h,
        "step_h": walk_forward.step_h,
        "n_steps": walk_forward.n_steps,
        "total_entries": walk_forward.total_entries,
        "total_blowups": walk_forward.total_blowups,
        "total_pnl_u": walk_forward.total_pnl_u,
        "max_step_drawdown_u": walk_forward.max_step_drawdown_u,
        "max_cumulative_drawdown_u": walk_forward.max_cumulative_drawdown_u,
        "avg_entries_per_step": walk_forward.avg_entries_per_step,
        "steps": [asdict(step) for step in walk_forward.steps],
    }

    (out_dir / "strategy_config.json").write_text(json.dumps(strategy_config, indent=2), encoding="utf-8")
    (out_dir / "allowed_states.json").write_text(json.dumps(allowed_states_json, indent=2), encoding="utf-8")
    (out_dir / "walk_forward_summary.json").write_text(json.dumps(walk_forward_summary, indent=2), encoding="utf-8")

    with (out_dir / "allowed_states.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["version", "pattern", "coverage_target", "state", "allow"])
        for state in latest_selection.allowed_state_strs:
            writer.writerow([version, pattern, coverage, state, 1])

    return out_dir


def main() -> None:
    args = _parse_args()
    patterns = [x.strip().upper() for x in args.patterns.split(",") if x.strip()]
    coverages = [float(x.strip()) for x in args.coverages.split(",") if x.strip()]
    out_root = Path(args.out_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    _emit_progress(stage="读取数据", detail="正在加载 BTC 1H 历史数据。", progress_percent=2)
    candles = load_binance_klines_csv(args.csv)
    candle_count = len(candles)
    effective_train_window_days = _effective_train_window_days(
        candle_count,
        args.train_window_days,
        args.risk_horizon,
        args.step_days,
    )
    cfg = MartingaleConfig(
        pattern_len=6,
        base_stake_u=args.base_stake,
        max_steps=6,
        payout_b=1.0,
        fee_rate=0.0,
    )

    scan_results: list[dict[str, object]] = []
    for index, pattern in enumerate(patterns):
        progress = 5 + int(((index + 1) / max(len(patterns), 1)) * 45)
        _emit_progress(
            stage="扫描 pattern",
            detail=f"正在扫描 {pattern} 的 coverage 区间。",
            progress_percent=progress,
            current_pattern=pattern,
            completed_patterns=index,
            total_patterns=len(patterns),
        )
        rows, scan_rows, baseline = scan_coverages(
            candles=candles,
            pattern_str=pattern,
            coverages=coverages,
            horizon_h=args.risk_horizon,
            train_ratio=args.train_ratio,
            cfg=cfg,
        )
        best = _best_row(scan_rows)
        selected = select_allowed_states(rows, coverage_target=best.coverage_target)
        scan_results.append(
            {
                "pattern": pattern,
                "baseline": {
                    "entries": baseline.n_entries,
                    "bets": baseline.n_bets,
                    "blowups": baseline.n_blowups,
                    "pnl_u": baseline.pnl_u,
                    "max_drawdown_u": baseline.max_drawdown_u,
                },
                "best_scan": {
                    "coverage_target": best.coverage_target,
                    "allowed_states_count": len(selected.allowed_state_strs),
                    "test_entries": best.test_entries,
                    "test_bets": best.test_bets,
                    "test_blowups": best.test_blowups,
                    "test_pnl_u": best.test_pnl_u,
                    "test_max_drawdown_u": best.test_max_drawdown_u,
                    "test_weighted_p6": best.test_weighted_p6,
                    "test_weighted_pgap6": best.test_weighted_pgap6,
                },
                "scan_rows": [
                    {
                        "coverage_target": row.coverage_target,
                        "allowed_states_count": row.allowed_states_count,
                        "test_entries": row.test_entries,
                        "test_bets": row.test_bets,
                        "test_blowups": row.test_blowups,
                        "test_pnl_u": row.test_pnl_u,
                        "test_max_drawdown_u": row.test_max_drawdown_u,
                        "test_weighted_p6": row.test_weighted_p6,
                        "test_weighted_pgap6": row.test_weighted_pgap6,
                        "train_coverage": row.train_coverage,
                        "test_coverage": row.test_coverage,
                    }
                    for row in scan_rows
                ],
            }
        )

    overall_best = min(
        scan_results,
        key=lambda item: (
            item["best_scan"]["test_blowups"],
            -item["best_scan"]["test_pnl_u"],
            item["best_scan"]["test_max_drawdown_u"],
            item["best_scan"]["test_weighted_p6"],
            abs(item["best_scan"]["coverage_target"] - 0.6),
        ),
    )

    _emit_progress(stage="清理旧候选", detail="正在清理上一轮自动候选目录。", progress_percent=55)
    _remove_previous_exports(out_root, args.version_prefix)

    generated_at_utc = datetime.now(timezone.utc).isoformat()
    exported_candidates: list[dict[str, object]] = []
    for index, item in enumerate(scan_results):
        pattern = str(item["pattern"])
        best_scan = item["best_scan"]
        coverage_target = float(best_scan["coverage_target"])
        version = f"{args.version_prefix}-{_sanitize_pattern(pattern)}-c{int(round(coverage_target * 100)):02d}"
        progress = 60 + int(((index + 1) / max(len(scan_results), 1)) * 35)
        _emit_progress(
            stage="导出候选策略",
            detail=f"正在导出 {version}。",
            progress_percent=progress,
            current_pattern=pattern,
            current_version=version,
            completed_patterns=index,
            total_patterns=len(scan_results),
        )

        latest_selection = _build_latest_allowed_states(
            candles=candles,
            pattern_str=pattern,
            coverage=coverage_target,
            horizon_h=args.risk_horizon,
            train_window_h=effective_train_window_days * 24,
        )
        walk_forward = run_walk_forward(
            candles=candles,
            pattern_str=pattern,
            coverage_target=coverage_target,
            train_window_h=effective_train_window_days * 24,
            step_h=args.step_days * 24,
            horizon_h=args.risk_horizon,
            cfg=cfg,
        )
        out_dir = _write_bundle(
            out_root=out_root,
            version=version,
            generated_at_utc=generated_at_utc,
            pattern=pattern,
            coverage=coverage_target,
            risk_horizon=args.risk_horizon,
            train_window_days=effective_train_window_days,
            step_days=args.step_days,
            base_stake=args.base_stake,
            latest_selection=latest_selection,
            walk_forward=walk_forward,
        )
        candidate = {
            "key": version,
            "version": version,
            "dir": str(out_dir),
            "pattern": pattern,
            "coverage_target": coverage_target,
            "allowed_states_count": len(latest_selection.allowed_state_strs),
            "train_window_days": effective_train_window_days,
            "step_days": args.step_days,
            "base_stake_u": args.base_stake,
            "total_entries": walk_forward.total_entries,
            "total_blowups": walk_forward.total_blowups,
            "total_pnl_u": walk_forward.total_pnl_u,
            "max_step_drawdown_u": walk_forward.max_step_drawdown_u,
            "max_cumulative_drawdown_u": walk_forward.max_cumulative_drawdown_u,
            "profitable_steps": sum(1 for step in walk_forward.steps if step.test_pnl_u > 0),
            "losing_steps": sum(1 for step in walk_forward.steps if step.test_pnl_u < 0),
        }
        candidate["recommendation_score"] = _score_candidate(candidate)
        exported_candidates.append(candidate)

    recommended = max(exported_candidates, key=lambda item: item["recommendation_score"])
    for item in exported_candidates:
        item["recommended"] = item["version"] == recommended["version"]
        item["recommendation_reason"] = (
            "当前按“覆盖率接近 60% + 样本外总收益为正 + 回撤可控”规则推荐这套策略。"
            if item["recommended"]
            else f"这套策略保留为候选，coverage={round(float(item['coverage_target']) * 100)}%。"
        )

    summary = {
        "generated_at_utc": generated_at_utc,
        "csv": str(Path(args.csv).resolve()),
        "patterns": patterns,
        "coverages": coverages,
        "risk_horizon_h": args.risk_horizon,
        "train_ratio": args.train_ratio,
        "requested_train_window_days": args.train_window_days,
        "effective_train_window_days": effective_train_window_days,
        "step_days": args.step_days,
        "base_stake_u": args.base_stake,
        "version_prefix": args.version_prefix,
        "out_dir": str(out_root.resolve()),
        "overall_best_pattern": overall_best["pattern"],
        "overall_best_coverage_target": overall_best["best_scan"]["coverage_target"],
        "recommended_version": recommended["version"],
        "candidates": exported_candidates,
        "scan_results": scan_results,
    }

    summary_path = out_root / f"{args.version_prefix}-scan-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    _emit_progress(stage="完成", detail="全量重算并选优完成，正在刷新策略中心。", progress_percent=100)
    _emit_result(summary)


if __name__ == "__main__":
    main()
