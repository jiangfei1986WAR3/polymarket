from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.data.binance_csv import load_binance_klines_csv  # noqa: E402
from martingale_research.martingale import (  # noqa: E402
    MartingaleConfig,
    scan_coverages,
    select_allowed_states,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="candidate-scan")
    p.add_argument(
        "--csv",
        default=str(ROOT / "data" / "raw" / "binance" / "BTCUSDT_1h_365d.csv"),
        help="Path to Binance 1H CSV",
    )
    p.add_argument(
        "--patterns",
        default="DUUUUU,UDDDDD,DDDDDD,UUUUUU",
        help="Comma-separated list of 6-char U/D patterns",
    )
    p.add_argument(
        "--coverages",
        default="0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9",
        help="Comma-separated target coverages",
    )
    p.add_argument("--risk-horizon", type=int, default=72)
    p.add_argument("--train-ratio", type=float, default=0.75)
    p.add_argument("--base-stake", type=float, default=2.0)
    return p.parse_args()


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


def main() -> None:
    args = _parse_args()
    patterns = [x.strip().upper() for x in args.patterns.split(",") if x.strip()]
    coverages = [float(x.strip()) for x in args.coverages.split(",") if x.strip()]

    candles = load_binance_klines_csv(args.csv)
    cfg = MartingaleConfig(
        pattern_len=6,
        base_stake_u=args.base_stake,
        max_steps=6,
        payout_b=1.0,
        fee_rate=0.0,
    )

    overall = []
    for pattern in patterns:
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
        overall.append((pattern, best, selected))

        print(f"\nPATTERN\t{pattern}")
        print(
            "BASELINE_TEST\t"
            f"entries={baseline.n_entries}\t"
            f"bets={baseline.n_bets}\t"
            f"blowups={baseline.n_blowups}\t"
            f"pnl_u={baseline.pnl_u:.2f}\t"
            f"max_dd_u={baseline.max_drawdown_u:.2f}"
        )
        print(
            "coverage_target\tallowed_states\ttrain_cov\ttest_cov\ttrain_p6\ttest_p6\t"
            "train_pgap6\ttest_pgap6\ttest_entries\ttest_blowups\ttest_pnl_u\ttest_max_dd_u"
        )
        for row in scan_rows:
            print(
                f"{row.coverage_target:.2f}\t{row.allowed_states_count}\t{row.train_coverage:.4f}\t"
                f"{row.test_coverage:.4f}\t{row.train_weighted_p6:.4f}\t{row.test_weighted_p6:.4f}\t"
                f"{row.train_weighted_pgap6:.4f}\t{row.test_weighted_pgap6:.4f}\t"
                f"{row.test_entries}\t{row.test_blowups}\t{row.test_pnl_u:.2f}\t{row.test_max_drawdown_u:.2f}"
            )

        print(
            "BEST\t"
            f"coverage={best.coverage_target:.2f}\t"
            f"entries={best.test_entries}\t"
            f"blowups={best.test_blowups}\t"
            f"pnl_u={best.test_pnl_u:.2f}\t"
            f"max_dd_u={best.test_max_drawdown_u:.2f}\t"
            f"test_p6={best.test_weighted_p6:.4f}"
        )
        print("ALLOWED_STATES\t" + ",".join(selected.allowed_state_strs))

    overall_best = min(
        overall,
        key=lambda item: (
            item[1].test_blowups,
            -item[1].test_pnl_u,
            item[1].test_max_drawdown_u,
            item[1].test_weighted_p6,
            abs(item[1].coverage_target - 0.6),
        ),
    )
    pattern, best, selected = overall_best
    print("\nOVERALL_BEST")
    print(
        f"pattern={pattern}\tcoverage={best.coverage_target:.2f}\tallowed_states={len(selected.allowed_state_strs)}\t"
        f"entries={best.test_entries}\tblowups={best.test_blowups}\tpnl_u={best.test_pnl_u:.2f}\t"
        f"max_dd_u={best.test_max_drawdown_u:.2f}\ttest_p6={best.test_weighted_p6:.4f}"
    )
    print("OVERALL_ALLOWED_STATES\t" + ",".join(selected.allowed_state_strs))


if __name__ == "__main__":
    main()
