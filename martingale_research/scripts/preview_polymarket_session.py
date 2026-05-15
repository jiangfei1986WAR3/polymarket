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

from martingale_research.execution import PolymarketSessionBridge  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="preview-polymarket-session")
    p.add_argument(
        "--trading-config",
        default=str(ROOT / "config" / "polymarket_trading_session.example.json"),
        help="Path to Polymarket trading session config",
    )
    p.add_argument(
        "--wallet-address",
        default="",
        help="Optional wallet address override for this session",
    )
    p.add_argument(
        "--funder-address",
        default="",
        help="Optional funder address override for this session",
    )
    p.add_argument(
        "--private-key",
        default="",
        help="Optional explicit private key override for this session",
    )
    p.add_argument(
        "--env-var",
        default="POLYMARKET_PRIVATE_KEY",
        help="Environment variable to read private key from when --private-key is empty",
    )
    p.add_argument(
        "--prompt-private-key",
        action="store_true",
        help="Prompt securely for private key if explicit/env values are missing",
    )
    p.add_argument(
        "--derive-creds",
        action="store_true",
        help="Attempt to derive L2 credentials via installed SDK",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    bridge = PolymarketSessionBridge.from_json(args.trading_config)
    private_key, source = bridge.resolve_private_key(
        explicit_private_key=args.private_key,
        env_var=args.env_var,
        allow_prompt=args.prompt_private_key,
    )
    runtime_client = bridge.build_trading_client(
        private_key=private_key,
        wallet_address=args.wallet_address or None,
        funder_address=args.funder_address or None,
    )
    status = runtime_client.session_status()
    bridge_status = bridge.bridge_status(private_key_source=source, runtime_status=status)

    print("runtime_status")
    print(json.dumps(status.__dict__, ensure_ascii=True, indent=2))
    print("bridge_status")
    print(json.dumps(bridge_status.__dict__, ensure_ascii=True, indent=2))

    if not args.derive_creds:
        return

    if not private_key:
        print("derive_creds_error", "missing private key")
        return

    try:
        creds = bridge.try_derive_api_creds(
            private_key=private_key,
            wallet_address=args.wallet_address or None,
            funder_address=args.funder_address or None,
        )
    except Exception as exc:  # pragma: no cover - integration path
        print("derive_creds_error", str(exc))
        return

    print("derived_creds")
    print(json.dumps(creds.__dict__, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
