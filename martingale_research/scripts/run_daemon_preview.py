from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.data.binance_csv import load_binance_klines_csv  # noqa: E402
from martingale_research.execution import (  # noqa: E402
    DryRunExecutionAdapter,
    load_runtime_state,
    load_strategy_bundle,
    process_available_candles,
    save_runtime_state,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="run-daemon-preview")
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
        default=str(ROOT / "runtime_state" / "daemon_state.json"),
        help="JSON state file for daemon preview",
    )
    p.add_argument(
        "--broker-log",
        default=str(ROOT / "runtime_state" / "daemon_broker_events.jsonl"),
        help="JSONL log file for dry-run broker events",
    )
    p.add_argument("--poll-seconds", type=int, default=60, help="Polling interval for loop mode")
    p.add_argument("--loop", action="store_true", help="Run continuously instead of once")
    p.add_argument("--max-loops", type=int, default=0, help="Optional guard for loop mode; 0 means unlimited")
    return p.parse_args()


def _run_once(args: argparse.Namespace) -> int:
    strategy, allowed_states = load_strategy_bundle(args.strategy_dir)
    runtime_state = load_runtime_state(args.state_file, strategy_version=strategy.version)
    candles = load_binance_klines_csv(args.csv)
    adapter = DryRunExecutionAdapter(args.broker_log)

    report = process_available_candles(
        candles=candles,
        strategy=strategy,
        allowed_states=allowed_states,
        state=runtime_state,
        adapter=adapter,
    )
    save_runtime_state(args.state_file, report.state)

    print("mode", report.mode)
    print("processed_count", report.processed_count)
    print("last_processed_candle_open_time_ms", report.state.last_processed_candle_open_time_ms)
    print("in_run", report.state.in_run)
    print("current_step", report.state.current_step)
    print("total_runs_started", report.state.total_runs_started)
    print("total_wins", report.state.total_wins)
    print("total_losses", report.state.total_losses)
    print("total_blowups", report.state.total_blowups)
    if report.reports:
        last = report.reports[-1]
        print("last_candle", last.processed_candle_open_time_ms)
        print("last_outcome", last.resolved_outcome)
        print("last_action", last.action)
        print("last_direction", last.direction)
    else:
        print("last_candle", None)
        print("last_outcome", None)
        print("last_action", "NOOP")
        print("last_direction", None)
    return report.processed_count


def main() -> None:
    args = _parse_args()
    if not args.loop:
        _run_once(args)
        return

    loop_index = 0
    while True:
        _run_once(args)
        loop_index += 1
        if args.max_loops > 0 and loop_index >= args.max_loops:
            break
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()
