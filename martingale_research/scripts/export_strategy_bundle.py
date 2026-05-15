from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
import sys


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
    select_allowed_states,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="export-strategy-bundle")
    p.add_argument(
        "--csv",
        default=str(ROOT / "data" / "raw" / "binance" / "BTCUSDT_1h_365d.csv"),
        help="Path to Binance 1H CSV",
    )
    p.add_argument("--pattern", default="DUUUUU")
    p.add_argument("--coverage", type=float, default=0.55)
    p.add_argument("--risk-horizon", type=int, default=72)
    p.add_argument("--train-window-days", type=int, default=365)
    p.add_argument("--step-days", type=int, default=7)
    p.add_argument("--base-stake", type=float, default=2.0)
    p.add_argument("--version", default="")
    p.add_argument(
        "--out-dir",
        default=str(ROOT / "strategy_outputs"),
        help="Directory for exported strategy files",
    )
    return p.parse_args()


def _default_version() -> str:
    iso = datetime.now(timezone.utc).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


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


def main() -> None:
    args = _parse_args()
    version = args.version or _default_version()
    out_root = Path(args.out_dir)
    out_dir = out_root / version
    out_dir.mkdir(parents=True, exist_ok=True)

    candles = load_binance_klines_csv(args.csv)
    cfg = MartingaleConfig(
        pattern_len=6,
        base_stake_u=args.base_stake,
        max_steps=6,
        payout_b=1.0,
        fee_rate=0.0,
    )
    train_window_h = args.train_window_days * 24
    step_h = args.step_days * 24

    latest_selection = _build_latest_allowed_states(
        candles=candles,
        pattern_str=args.pattern,
        coverage=args.coverage,
        horizon_h=args.risk_horizon,
        train_window_h=train_window_h,
    )
    wf = run_walk_forward(
        candles=candles,
        pattern_str=args.pattern,
        coverage_target=args.coverage,
        train_window_h=train_window_h,
        step_h=step_h,
        horizon_h=args.risk_horizon,
        cfg=cfg,
    )

    strategy_config = {
        "version": version,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "pattern": args.pattern,
        "coverage_target": args.coverage,
        "risk_horizon_h": args.risk_horizon,
        "train_window_days": args.train_window_days,
        "step_days": args.step_days,
        "base_stake_u": args.base_stake,
        "max_steps": 6,
        "allowed_states_count": len(latest_selection.allowed_state_strs),
    }
    allowed_states_json = {
        "version": version,
        "pattern": args.pattern,
        "coverage_target": args.coverage,
        "allowed_states": list(latest_selection.allowed_state_strs),
    }
    walk_forward_summary = {
        "version": version,
        "pattern": wf.pattern_str,
        "coverage_target": wf.coverage_target,
        "train_window_h": wf.train_window_h,
        "step_h": wf.step_h,
        "n_steps": wf.n_steps,
        "total_entries": wf.total_entries,
        "total_blowups": wf.total_blowups,
        "total_pnl_u": wf.total_pnl_u,
        "max_step_drawdown_u": wf.max_step_drawdown_u,
        "max_cumulative_drawdown_u": wf.max_cumulative_drawdown_u,
        "avg_entries_per_step": wf.avg_entries_per_step,
        "steps": [step.__dict__ for step in wf.steps],
    }

    (out_dir / "strategy_config.json").write_text(json.dumps(strategy_config, indent=2), encoding="utf-8")
    (out_dir / "allowed_states.json").write_text(json.dumps(allowed_states_json, indent=2), encoding="utf-8")
    (out_dir / "walk_forward_summary.json").write_text(json.dumps(walk_forward_summary, indent=2), encoding="utf-8")

    with (out_dir / "allowed_states.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["version", "pattern", "coverage_target", "state", "allow"])
        for state in latest_selection.allowed_state_strs:
            writer.writerow([version, args.pattern, args.coverage, state, 1])

    print("exported", out_dir)
    print("pattern", args.pattern)
    print("coverage", args.coverage)
    print("allowed_states_count", len(latest_selection.allowed_state_strs))
    print("walk_forward_steps", wf.n_steps)
    print("walk_forward_total_entries", wf.total_entries)
    print("walk_forward_total_blowups", wf.total_blowups)
    print("walk_forward_total_pnl_u", round(wf.total_pnl_u, 4))
    print("walk_forward_max_step_dd_u", round(wf.max_step_drawdown_u, 4))
    print("walk_forward_max_cumulative_dd_u", round(wf.max_cumulative_drawdown_u, 4))


if __name__ == "__main__":
    main()
