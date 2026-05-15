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
    p = argparse.ArgumentParser(prog="run-allowance-refresh")
    p.add_argument(
        "--trading-config",
        default=str(ROOT / "config" / "polymarket_trading_session.example.json"),
        help="Path to Polymarket trading session config",
    )
    p.add_argument("--wallet-address", default="", help="Optional wallet address override")
    p.add_argument("--funder-address", required=True, help="Funder address to test")
    p.add_argument("--private-key", default="", help="Optional explicit private key for this run only")
    p.add_argument("--env-var", default="POLYMARKET_PRIVATE_KEY", help="Private key environment variable")
    p.add_argument("--prompt-private-key", action="store_true", help="Prompt securely for private key")
    p.add_argument("--asset-type", default="COLLATERAL", help="Asset type: COLLATERAL or CONDITIONAL")
    p.add_argument("--token-id", default="", help="Optional token id for CONDITIONAL")
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
        funder_address=args.funder_address,
    )
    runtime_status = runtime_client.session_status()
    bridge_status = bridge.bridge_status(private_key_source=source, runtime_status=runtime_status)

    print("runtime_status")
    print(json.dumps(runtime_status.__dict__, ensure_ascii=True, indent=2))
    print("bridge_status")
    print(json.dumps(bridge_status.__dict__, ensure_ascii=True, indent=2))

    if not private_key:
        print("error")
        print("missing private key")
        return

    creds = bridge.try_derive_api_creds(
        private_key=private_key,
        wallet_address=args.wallet_address or None,
        funder_address=args.funder_address,
    )
    print("derived_creds_present")
    print(json.dumps({"present": bool(creds.key and creds.secret and creds.passphrase)}, ensure_ascii=True, indent=2))

    before = bridge.try_get_balance_allowance(
        private_key=private_key,
        wallet_address=args.wallet_address or None,
        funder_address=args.funder_address,
        creds=creds,
        asset_type=args.asset_type,
        token_id=args.token_id or None,
    )
    print("before")
    print(json.dumps(before.__dict__, ensure_ascii=True, indent=2))

    try:
        updated = bridge.try_update_balance_allowance(
            private_key=private_key,
            wallet_address=args.wallet_address or None,
            funder_address=args.funder_address,
            creds=creds,
            asset_type=args.asset_type,
            token_id=args.token_id or None,
        )
        print("update_result")
        print(json.dumps(updated, ensure_ascii=True, indent=2))
    except Exception as exc:
        print("update_error")
        print(str(exc))
        return

    after = bridge.try_get_balance_allowance(
        private_key=private_key,
        wallet_address=args.wallet_address or None,
        funder_address=args.funder_address,
        creds=creds,
        asset_type=args.asset_type,
        token_id=args.token_id or None,
    )
    print("after")
    print(json.dumps(after.__dict__, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
