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
    p = argparse.ArgumentParser(prog="run-real-sdk-bridge")
    p.add_argument(
        "--trading-config",
        default=str(ROOT / "config" / "polymarket_trading_session.example.json"),
        help="Path to Polymarket trading session config",
    )
    p.add_argument("--wallet-address", default="", help="Optional wallet address override")
    p.add_argument("--funder-address", default="", help="Funder address required for balance allowance")
    p.add_argument("--private-key", default="", help="Optional explicit private key for this run only")
    p.add_argument("--env-var", default="POLYMARKET_PRIVATE_KEY", help="Private key environment variable")
    p.add_argument("--prompt-private-key", action="store_true", help="Prompt securely for private key")
    p.add_argument("--skip-derive", action="store_true", help="Skip real derive creds call")
    p.add_argument("--asset-type", default="COLLATERAL", help="Balance allowance asset type: COLLATERAL or CONDITIONAL")
    p.add_argument("--token-id", default="", help="Token id for CONDITIONAL balance allowance")
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
    runtime_status = runtime_client.session_status()
    bridge_status = bridge.bridge_status(private_key_source=source, runtime_status=runtime_status)

    print("runtime_status")
    print(json.dumps(runtime_status.__dict__, ensure_ascii=True, indent=2))
    print("bridge_status")
    print(json.dumps(bridge_status.__dict__, ensure_ascii=True, indent=2))

    if not private_key:
        print("error", "missing private key")
        return

    derived_creds = bridge.base_config.creds
    if not args.skip_derive:
        try:
            derived_creds = bridge.try_derive_api_creds(
                private_key=private_key,
                wallet_address=args.wallet_address or None,
                funder_address=args.funder_address or None,
            )
            print("derived_creds")
            print(json.dumps(derived_creds.__dict__, ensure_ascii=True, indent=2))
        except Exception as exc:
            print("derive_creds_error")
            print(str(exc))
            return

    if not (args.funder_address or bridge.base_config.funder_address):
        print("balance_allowance_skipped")
        print("missing funder_address")
        return

    try:
        result = bridge.try_get_balance_allowance(
            private_key=private_key,
            wallet_address=args.wallet_address or None,
            funder_address=args.funder_address or None,
            creds=derived_creds,
            asset_type=args.asset_type,
            token_id=args.token_id or None,
        )
        print("balance_allowance")
        print(json.dumps(result.__dict__, ensure_ascii=True, indent=2))
    except Exception as exc:
        print("balance_allowance_error")
        print(str(exc))


if __name__ == "__main__":
    main()
