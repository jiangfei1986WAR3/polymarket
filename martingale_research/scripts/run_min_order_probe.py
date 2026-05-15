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

from py_clob_client_v2.clob_types import MarketOrderArgs, OrderType  # noqa: E402
from py_clob_client_v2.order_builder.constants import BUY, SELL  # noqa: E402

from martingale_research.execution import PolymarketSessionBridge  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="run-min-order-probe")
    p.add_argument(
        "--trading-config",
        default=str(ROOT / "config" / "polymarket_trading_session.example.json"),
        help="Path to Polymarket trading session config",
    )
    p.add_argument("--funder-address", required=True, help="Funder address used by authenticated client")
    p.add_argument("--wallet-address", default="", help="Optional wallet address override")
    p.add_argument("--private-key", default="", help="Optional explicit private key for this run only")
    p.add_argument("--env-var", default="POLYMARKET_PRIVATE_KEY", help="Private key environment variable")
    p.add_argument("--prompt-private-key", action="store_true", help="Prompt securely for private key")
    p.add_argument("--token-id", required=True, help="Target token id")
    p.add_argument("--amount", type=float, default=1.0, help="USDC amount for a minimal market order")
    p.add_argument("--price", type=float, default=0.99, help="Protection price used for market order")
    p.add_argument("--side", choices=["BUY", "SELL"], default="BUY", help="Order side")
    p.add_argument("--order-type", choices=["FOK", "FAK"], default="FOK", help="Order type for probe")
    return p.parse_args()


def _create_sdk_client(bridge: PolymarketSessionBridge, *, private_key: str, wallet_address: str, funder_address: str):
    creds = bridge.try_derive_api_creds(
        private_key=private_key,
        wallet_address=wallet_address or None,
        funder_address=funder_address,
    )
    runtime_cfg = bridge.build_runtime_config(
        private_key=private_key,
        wallet_address=wallet_address or None,
        funder_address=funder_address,
        creds=creds,
    )
    client_cls, module_name = bridge._load_clob_client_class()
    if client_cls is None:
        raise RuntimeError("Polymarket SDK is not available")
    client = bridge._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg)
    return client, creds, module_name


def main() -> None:
    args = _parse_args()
    bridge = PolymarketSessionBridge.from_json(args.trading_config)
    private_key, source = bridge.resolve_private_key(
        explicit_private_key=args.private_key,
        env_var=args.env_var,
        allow_prompt=args.prompt_private_key,
    )
    if not private_key:
        print("error")
        print("missing private key")
        return

    runtime_client = bridge.build_trading_client(
        private_key=private_key,
        wallet_address=args.wallet_address or None,
        funder_address=args.funder_address,
    )
    print("runtime_status")
    print(json.dumps(runtime_client.session_status().__dict__, ensure_ascii=True, indent=2))
    print("private_key_source")
    print(source)

    try:
        sdk_client, creds, module_name = _create_sdk_client(
            bridge,
            private_key=private_key,
            wallet_address=args.wallet_address,
            funder_address=args.funder_address,
        )
        print("derived_creds_present")
        print(json.dumps({"present": bool(creds.key and creds.secret and creds.passphrase), "sdk_module": module_name}, ensure_ascii=True, indent=2))
    except Exception as exc:
        print("derive_error")
        print(str(exc))
        return

    side_value = BUY if args.side == "BUY" else SELL
    order_type = getattr(OrderType, args.order_type)
    market_args = MarketOrderArgs(
        token_id=args.token_id,
        amount=float(args.amount),
        side=side_value,
        price=float(args.price),
        order_type=order_type,
    )

    print("market_order_args")
    print(
        json.dumps(
            {
                "token_id": args.token_id,
                "amount": args.amount,
                "side": args.side,
                "price": args.price,
                "order_type": args.order_type,
            },
            ensure_ascii=True,
            indent=2,
        )
    )

    try:
        signed = sdk_client.create_market_order(market_args)
        print("signed_order")
        print(json.dumps(signed, ensure_ascii=True, indent=2, default=str))
    except Exception as exc:
        print("create_market_order_error")
        print(str(exc))
        return

    try:
        posted = sdk_client.post_order(signed, order_type)
        print("post_order_result")
        print(json.dumps(posted, ensure_ascii=True, indent=2, default=str))
    except Exception as exc:
        print("post_order_error")
        print(str(exc))


if __name__ == "__main__":
    main()
