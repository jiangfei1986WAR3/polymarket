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

from martingale_research.execution import (  # noqa: E402
    PolymarketApiCreds,
    PolymarketPreparedOrder,
    PolymarketTradingClient,
    PolymarketTradingSessionConfig,
)


class TestPolymarketTrading(unittest.TestCase):
    def test_session_status_readiness(self) -> None:
        client = PolymarketTradingClient(
            PolymarketTradingSessionConfig(
                clob_base_url="https://clob.polymarket.com",
                chain_id=137,
                signature_type=0,
                funder_address="0xfunder",
                wallet_address="0xwallet",
                private_key="0xabc",
                creds=PolymarketApiCreds(key="k", secret="s", passphrase="p"),
            )
        )

        status = client.session_status()

        self.assertTrue(status.ready_for_l1)
        self.assertTrue(status.ready_for_l2)
        self.assertTrue(status.wallet_address_present)
        self.assertTrue(status.api_key_present)

    def test_build_post_order_request_from_prepared_order(self) -> None:
        client = PolymarketTradingClient()
        prepared = PolymarketPreparedOrder(
            created_at_utc="2026-05-13T00:00:00Z",
            strategy_version="demo",
            market_slug="btc-up-or-down-1h",
            market_name="BTC 1H Up or Down",
            target_candle_open_time_ms=123456,
            decision_action="BET_STEP_2",
            pattern="UUUUUU",
            current_state="DUUUUD",
            martingale_step=2,
            direction_ud="U",
            side_yes_no="YES",
            token_id="yes-token",
            price=0.5,
            size=2.0,
            wallet_address="0xwallet",
            clob_base_url="https://clob.polymarket.com",
            reason="continue",
        )

        req = client.build_post_order_request(prepared_order=prepared)

        self.assertEqual(req.request_type, "post_order")
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.path, "/order")
        self.assertTrue(req.requires_l1)
        self.assertTrue(req.requires_l2)
        self.assertEqual(req.payload["tokenID"], "yes-token")
        self.assertEqual(req.payload["martingaleStep"], 2)
        self.assertEqual(req.payload["sideYesNo"], "YES")

    def test_from_json_loads_session_config(self) -> None:
        raw = {
            "clob_base_url": "https://clob.polymarket.com",
            "chain_id": 137,
            "signature_type": 0,
            "funder_address": "0xfunder",
            "wallet_address": "0xwallet",
            "private_key": "0xabc",
            "creds": {"key": "k", "secret": "s", "passphrase": "p"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trading.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            client = PolymarketTradingClient.from_json(path)

        self.assertEqual(client.config.chain_id, 137)
        self.assertEqual(client.config.creds.key, "k")
        self.assertEqual(client.config.funder_address, "0xfunder")


if __name__ == "__main__":
    unittest.main()
