from __future__ import annotations

import argparse
import json
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
    PolymarketExecutionAdapter,
    evaluate_decision,
    load_strategy_bundle,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="preview-polymarket-adapter")
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
        "--adapter-config",
        default=str(ROOT / "config" / "polymarket_adapter.example.json"),
        help="Path to Polymarket adapter config json",
    )
    p.add_argument(
        "--current-step",
        type=int,
        default=0,
        help="0 means flat; 1..6 means continue the current martingale step",
    )
    p.add_argument(
        "--out-log",
        default=str(ROOT / "runtime_state" / "polymarket_prepared_orders.jsonl"),
        help="JSONL output path for prepared order previews",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    strategy, allowed_states = load_strategy_bundle(args.strategy_dir)
    candles = load_binance_klines_csv(args.csv)
    current_step = args.current_step if args.current_step > 0 else None

    decision = evaluate_decision(
        candles=candles,
        strategy=strategy,
        allowed_states=allowed_states,
        current_step=current_step,
    )
    adapter = PolymarketExecutionAdapter.from_json(args.adapter_config, log_path=args.out_log)

    print("connection_status", json.dumps(adapter.connection_status(), ensure_ascii=True))
    print("recommended_action", decision.recommended_action)
    print("current_state", decision.current_state)
    print("next_direction", decision.next_direction)
    if decision.recommended_action == "BLOCK":
        print("prepared_order", None)
        return

    prepared = adapter.prepare_order(
        decision=decision,
        target_candle_open_time_ms=candles[-1].open_time_ms + 3600_000,
    )
    print("prepared_order")
    print(json.dumps(prepared.__dict__, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
