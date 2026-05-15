from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


def _ensure_src_on_path() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


_ensure_src_on_path()

from martingale_research.execution import PolymarketPublicClient, PolymarketPublicClientConfig  # noqa: E402


class RecordingClient(PolymarketPublicClient):
    def __init__(self) -> None:
        super().__init__(PolymarketPublicClientConfig())
        self.calls: list[tuple[str, str, dict | None]] = []

    def _fetch_json(self, base_url: str, path: str, params=None):
        self.calls.append((base_url, path, params))
        if path == "/markets":
            return [
                {
                    "id": "1",
                    "question": "BTC up?",
                    "slug": "btc-up-or-down-1h",
                    "active": True,
                    "closed": False,
                    "enableOrderBook": True,
                    "clobTokenIds": "[\"yes-token\", \"no-token\"]",
                    "outcomes": "[\"Yes\", \"No\"]",
                    "outcomePrices": "[\"0.55\", \"0.45\"]",
                }
            ]
        if path == "/book":
            return {
                "market": "cond-1",
                "asset_id": "yes-token",
                "timestamp": "2026-05-13T00:00:00Z",
                "bids": [{"price": "0.54", "size": "100"}],
                "asks": [{"price": "0.56", "size": "120"}],
                "min_order_size": "5",
                "tick_size": "0.01",
                "neg_risk": False,
                "hash": "abc",
            }
        if path == "/ok":
            return {"ok": True}
        return {}


class TestPolymarketClient(unittest.TestCase):
    def test_load_config_from_json(self) -> None:
        raw = {
            "gamma_base_url": "https://gamma-api.polymarket.com",
            "clob_base_url": "https://clob.polymarket.com",
            "chain_id": 137,
            "timeout_s": 5.0,
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "client.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            client = PolymarketPublicClient.from_json(path)

        self.assertEqual(client.config.chain_id, 137)
        self.assertEqual(client.config.timeout_s, 5.0)

    def test_lookup_market_by_slug_parses_tokens(self) -> None:
        client = RecordingClient()

        market = client.lookup_market_by_slug("btc-up-or-down-1h")

        self.assertIsNotNone(market)
        assert market is not None
        self.assertEqual(market.slug, "btc-up-or-down-1h")
        self.assertEqual(market.clob_token_ids, ("yes-token", "no-token"))
        self.assertEqual(market.outcomes, ("Yes", "No"))
        self.assertEqual(client.calls[0][1], "/markets")
        self.assertEqual(client.calls[0][2]["slug"], "btc-up-or-down-1h")

    def test_order_book_summary_parses_levels(self) -> None:
        client = RecordingClient()

        book = client.order_book_summary("yes-token")

        self.assertEqual(book.asset_id, "yes-token")
        self.assertEqual(book.bids[0].price, "0.54")
        self.assertEqual(book.asks[0].size, "120")
        self.assertEqual(client.calls[0][1], "/book")
        self.assertEqual(client.calls[0][2]["token_id"], "yes-token")

    def test_get_ok_calls_ok_endpoint(self) -> None:
        client = RecordingClient()

        result = client.get_ok()

        self.assertEqual(result["ok"], True)
        self.assertEqual(client.calls[0][1], "/ok")


if __name__ == "__main__":
    unittest.main()
