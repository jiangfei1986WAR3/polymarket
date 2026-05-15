from __future__ import annotations

import argparse
from pathlib import Path
import sys


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.data.binance_csv import load_binance_klines_csv  # noqa: E402
from martingale_research.execution import evaluate_decision, load_strategy_bundle  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="preview-decision")
    p.add_argument(
        "--strategy-dir",
        default=str(ROOT / "strategy_outputs" / "2026-W20-conservative"),
        help="Directory containing strategy_config.json and allowed_states.json",
    )
    p.add_argument(
        "--csv",
        default=str(ROOT / "data" / "raw" / "binance" / "BTCUSDT_1h_540d.csv"),
        help="Path to Binance 1H CSV",
    )
    p.add_argument(
        "--current-step",
        type=int,
        default=0,
        help="0 means currently flat; 1..6 means continue that martingale step",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    strategy, allowed_states = load_strategy_bundle(args.strategy_dir)
    candles = load_binance_klines_csv(args.csv)
    current_step = args.current_step if args.current_step > 0 else None

    report = evaluate_decision(
        candles=candles,
        strategy=strategy,
        allowed_states=allowed_states,
        current_step=current_step,
    )

    print("version", report.version)
    print("pattern", report.pattern)
    print("current_state", report.current_state)
    print("is_allowed", report.is_allowed)
    print("in_run", report.in_run)
    print("current_step", report.current_step)
    print("next_step", report.next_step)
    print("next_direction", report.next_direction)
    print("recommended_action", report.recommended_action)
    print("reason", report.reason)


if __name__ == "__main__":
    main()
