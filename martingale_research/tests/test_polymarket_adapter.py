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
    DecisionReport,
    PolymarketConnectionConfig,
    PolymarketExecutionAdapter,
    PolymarketMarketConfig,
)


class TestPolymarketAdapter(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = PolymarketConnectionConfig(
            clob_base_url="https://clob.polymarket.com",
            chain_id=137,
            wallet_address="0xabc",
        )
        self.market = PolymarketMarketConfig(
            market_slug="btc-up-or-down-1h",
            market_name="BTC 1H Up or Down",
            up_token_id="up-token",
            down_token_id="down-token",
            order_price=0.52,
            max_order_size=2.0,
        )

    def test_prepare_order_maps_u_to_yes_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            adapter = PolymarketExecutionAdapter(
                connection=self.connection,
                market=self.market,
                log_path=Path(tmp) / "orders.jsonl",
            )
            decision = DecisionReport(
                version="demo",
                pattern="UUUUUU",
                current_state="DDDDDD",
                is_allowed=True,
                in_run=False,
                current_step=None,
                next_step=1,
                next_direction="U",
                recommended_action="START_RUN",
                reason="allow",
            )

            prepared = adapter.prepare_order(
                decision=decision,
                target_candle_open_time_ms=123456,
            )

        self.assertEqual(prepared.side_yes_no, "YES")
        self.assertEqual(prepared.token_id, "up-token")
        self.assertEqual(prepared.price, 0.52)
        self.assertEqual(prepared.size, 2.0)
        self.assertEqual(prepared.martingale_step, 1)

    def test_prepare_order_maps_d_to_no_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            adapter = PolymarketExecutionAdapter(
                connection=self.connection,
                market=self.market,
                log_path=Path(tmp) / "orders.jsonl",
            )
            decision = DecisionReport(
                version="demo",
                pattern="DUUUUU",
                current_state="UDDDDD",
                is_allowed=True,
                in_run=True,
                current_step=2,
                next_step=2,
                next_direction="D",
                recommended_action="BET_STEP_2",
                reason="continue",
            )

            prepared = adapter.prepare_order(
                decision=decision,
                target_candle_open_time_ms=123456,
            )

        self.assertEqual(prepared.side_yes_no, "NO")
        self.assertEqual(prepared.token_id, "down-token")
        self.assertEqual(prepared.martingale_step, 2)

    def test_from_json_loads_config(self) -> None:
        raw = {
            "connection": {
                "clob_base_url": "https://clob.polymarket.com",
                "chain_id": 137,
                "wallet_address": "0xabc",
            },
            "market": {
                "market_slug": "btc-up-or-down-1h",
                "market_name": "BTC 1H Up or Down",
                "up_token_id": "up-token",
                "down_token_id": "down-token",
                "order_price": 0.5,
                "max_order_size": 2.0,
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "adapter.json"
            config_path.write_text(json.dumps(raw), encoding="utf-8")
            adapter = PolymarketExecutionAdapter.from_json(
                config_path,
                log_path=Path(tmp) / "orders.jsonl",
            )

            status = adapter.connection_status()

        self.assertEqual(status["clob_base_url"], "https://clob.polymarket.com")
        self.assertEqual(status["chain_id"], 137)
        self.assertTrue(status["wallet_address_present"])
        self.assertFalse(status["api_key_present"])


if __name__ == "__main__":
    unittest.main()
