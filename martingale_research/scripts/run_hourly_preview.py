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
from martingale_research.execution import (  # noqa: E402
    load_runtime_state,
    load_strategy_bundle,
    run_hourly_tick,
    save_runtime_state,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="run-hourly-preview")
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
        "--state-file",
        default=str(ROOT / "runtime_state" / "hourly_preview_state.json"),
        help="JSON state file for local preview runner",
    )
    p.add_argument(
        "--previous-outcome",
        choices=["win", "loss"],
        default=None,
        help="Resolve the previous active step before evaluating the current hour",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    strategy, allowed_states = load_strategy_bundle(args.strategy_dir)
    runtime_state = load_runtime_state(args.state_file, strategy_version=strategy.version)
    candles = load_binance_klines_csv(args.csv)

    result = run_hourly_tick(
        candles=candles,
        strategy=strategy,
        allowed_states=allowed_states,
        state=runtime_state,
        previous_outcome=args.previous_outcome,
    )
    save_runtime_state(args.state_file, result.state)

    print("state_file", args.state_file)
    print("strategy_version", result.state.strategy_version)
    print("current_state", result.decision.current_state)
    print("recommended_action", result.decision.recommended_action)
    print("next_direction", result.decision.next_direction)
    print("in_run", result.state.in_run)
    print("current_step", result.state.current_step)
    print("total_runs_started", result.state.total_runs_started)
    print("total_wins", result.state.total_wins)
    print("total_losses", result.state.total_losses)
    print("total_blowups", result.state.total_blowups)
    print("reason", result.decision.reason)


if __name__ == "__main__":
    main()
