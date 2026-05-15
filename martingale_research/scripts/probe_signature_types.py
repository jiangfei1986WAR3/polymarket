from __future__ import annotations

import argparse
import json
from dataclasses import replace
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
    p = argparse.ArgumentParser(prog="probe-signature-types")
    p.add_argument(
        "--trading-config",
        default=str(ROOT / "config" / "polymarket_trading_session.example.json"),
        help="Path to Polymarket trading session config",
    )
    p.add_argument("--funder-address", required=True, help="Candidate funder address to test")
    p.add_argument("--wallet-address", default="", help="Optional wallet address override")
    p.add_argument("--private-key", default="", help="Optional explicit private key for this run only")
    p.add_argument("--env-var", default="POLYMARKET_PRIVATE_KEY", help="Private key environment variable")
    p.add_argument("--prompt-private-key", action="store_true", help="Prompt securely for private key")
    p.add_argument("--asset-type", default="COLLATERAL", help="Balance allowance asset type")
    p.add_argument("--token-id", default="", help="Optional token id for CONDITIONAL balance queries")
    return p.parse_args()


def _run_one(signature_type: int, args: argparse.Namespace) -> dict[str, object]:
    bridge = PolymarketSessionBridge.from_json(args.trading_config)
    base_cfg = replace(bridge.base_config, signature_type=signature_type)
    bridge = PolymarketSessionBridge(base_cfg)
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
    out: dict[str, object] = {
        "signature_type": signature_type,
        "runtime_status": runtime_status.__dict__,
        "bridge_status": bridge_status.__dict__,
    }
    if not private_key:
        out["error"] = "missing private key"
        return out
    try:
        creds = bridge.try_derive_api_creds(
            private_key=private_key,
            wallet_address=args.wallet_address or None,
            funder_address=args.funder_address,
        )
        out["derived_creds_present"] = bool(creds.key and creds.secret and creds.passphrase)
    except Exception as exc:
        out["derive_error"] = str(exc)
        return out
    try:
        balance = bridge.try_get_balance_allowance(
            private_key=private_key,
            wallet_address=args.wallet_address or None,
            funder_address=args.funder_address,
            creds=creds,
            asset_type=args.asset_type,
            token_id=args.token_id or None,
        )
        out["balance_allowance"] = balance.__dict__
    except Exception as exc:
        out["balance_error"] = str(exc)
    return out


def main() -> None:
    args = _parse_args()
    results = [_run_one(sig, args) for sig in (0, 1, 2)]
    print(json.dumps(results, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
