from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


def _ensure_src_on_path() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


_ensure_src_on_path()

from martingale_research.execution import (  # noqa: E402
    PolymarketApiCreds,
    PolymarketBalanceAllowanceResult,
    PolymarketSessionBridge,
    PolymarketTradingSessionConfig,
)


class FakeApiCreds:
    def __init__(self, api_key: str, api_secret: str, api_passphrase: str) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.api_passphrase = api_passphrase


class FakeBalanceAllowanceParams:
    def __init__(self, asset_type=None, token_id=None, signature_type=-1) -> None:
        self.asset_type = asset_type
        self.token_id = token_id
        self.signature_type = signature_type


class FakeSdkClient:
    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs
        self.last_params = None

    def create_or_derive_api_key(self):
        return {"apiKey": "k", "secret": "s", "passphrase": "p"}

    def get_balance_allowance(self, params):
        self.last_params = params
        return {"balance": "12.5", "allowance": "9.5"}


class TestPolymarketSession(unittest.TestCase):
    def test_resolve_private_key_from_env(self) -> None:
        bridge = PolymarketSessionBridge()
        with patch.dict(os.environ, {"POLYMARKET_PRIVATE_KEY": "env-key"}, clear=False):
            key, source = bridge.resolve_private_key()

        self.assertEqual(key, "env-key")
        self.assertEqual(source, "env:POLYMARKET_PRIVATE_KEY")

    def test_resolve_private_key_from_prompt(self) -> None:
        bridge = PolymarketSessionBridge()
        with patch.dict(os.environ, {}, clear=True):
            key, source = bridge.resolve_private_key(
                allow_prompt=True,
                prompt_fn=lambda _: "prompt-key",
            )

        self.assertEqual(key, "prompt-key")
        self.assertEqual(source, "prompt")

    def test_bridge_status_without_sdk(self) -> None:
        bridge = PolymarketSessionBridge(
            PolymarketTradingSessionConfig(
                private_key="0xabc",
                wallet_address="0xwallet",
            )
        )
        with patch.object(bridge, "_load_clob_client_class", return_value=(None, "")):
            status = bridge.bridge_status(private_key_source="explicit")

        self.assertFalse(status.sdk_available)
        self.assertTrue(status.private_key_present)
        self.assertTrue(status.ready_for_l1)
        self.assertFalse(status.can_attempt_derive_l2)

    def test_try_derive_api_creds_with_fake_sdk(self) -> None:
        bridge = PolymarketSessionBridge(
            PolymarketTradingSessionConfig(
                clob_base_url="https://clob.polymarket.com",
                chain_id=137,
                signature_type=1,
                funder_address="0xfunder",
            )
        )
        with (
            patch.object(bridge, "_load_clob_client_class", return_value=(FakeSdkClient, "fake.module")),
            patch.object(bridge, "_load_api_creds_class", return_value=FakeApiCreds),
        ):
            creds = bridge.try_derive_api_creds(
                private_key="0xabc",
                wallet_address="0xwallet",
                funder_address="0xfunder",
            )

        self.assertEqual(creds, PolymarketApiCreds(key="k", secret="s", passphrase="p"))

    def test_try_get_balance_allowance_with_fake_sdk(self) -> None:
        bridge = PolymarketSessionBridge(
            PolymarketTradingSessionConfig(
                clob_base_url="https://clob.polymarket.com",
                chain_id=137,
                signature_type=1,
                funder_address="0xfunder",
            )
        )
        fake_client = FakeSdkClient()
        with (
            patch.object(bridge, "_load_clob_client_class", return_value=(FakeSdkClient, "fake.module")),
            patch.object(bridge, "_load_api_creds_class", return_value=FakeApiCreds),
            patch.object(bridge, "_load_balance_allowance_params_class", return_value=FakeBalanceAllowanceParams),
            patch.object(bridge, "_load_asset_type_value", return_value="COLLATERAL"),
            patch.object(bridge, "_create_sdk_client", return_value=fake_client),
        ):
            result = bridge.try_get_balance_allowance(
                private_key="0xabc",
                wallet_address="0xwallet",
                funder_address="0xfunder",
                creds=PolymarketApiCreds(key="k", secret="s", passphrase="p"),
                asset_type="COLLATERAL",
            )

        self.assertEqual(
            result,
            PolymarketBalanceAllowanceResult(
                asset_type="COLLATERAL",
                token_id=None,
                balance="12.5",
                allowance="9.5",
                raw={"balance": "12.5", "allowance": "9.5"},
            ),
        )


if __name__ == "__main__":
    unittest.main()
