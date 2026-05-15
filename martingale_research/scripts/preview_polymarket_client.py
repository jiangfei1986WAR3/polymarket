from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.execution import PolymarketPublicClient  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="preview-polymarket-client")
    p.add_argument(
        "--client-config",
        default=str(ROOT / "config" / "polymarket_public_client.example.json"),
        help="Path to public client config json",
    )
    p.add_argument(
        "--slug",
        default="btc-up-or-down-1h",
        help="Gamma market slug to lookup",
    )
    p.add_argument(
        "--skip-network",
        action="store_true",
        help="Only print config load result without performing HTTP requests",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    client = PolymarketPublicClient.from_json(args.client_config)
    print("client_config", json.dumps(client.config.__dict__, ensure_ascii=True))
    if args.skip_network:
        return

    ok = client.get_ok()
    print("clob_ok", json.dumps(ok, ensure_ascii=True))

    market = client.lookup_market_by_slug(args.slug)
    if market is None:
        print("market_lookup", None)
        market = client.get_first_active_market()
        if market is None:
            print("fallback_market", None)
            return
        print("fallback_market_from_active_list", market.slug)
    print("market_lookup")
    print(json.dumps(market.__dict__, ensure_ascii=True, indent=2))

    if market.clob_token_ids:
        book = client.order_book_summary(market.clob_token_ids[0])
        print("first_token_book")
        print(json.dumps(asdict(book), ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
