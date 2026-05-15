from __future__ import annotations

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
    def update_balance_allowance(self, params):
        return {"updated": True, "asset_type": params.asset_type, "token_id": params.token_id}


class TestAllowanceRefresh(unittest.TestCase):
    def test_try_update_balance_allowance_returns_dict(self) -> None:
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
            patch.object(bridge, "_load_balance_allowance_params_class", return_value=FakeBalanceAllowanceParams),
            patch.object(bridge, "_load_asset_type_value", return_value="COLLATERAL"),
            patch.object(bridge, "_create_sdk_client", return_value=FakeSdkClient()),
        ):
            result = bridge.try_update_balance_allowance(
                private_key="0xabc",
                wallet_address="0xwallet",
                funder_address="0xfunder",
                creds=PolymarketApiCreds(key="k", secret="s", passphrase="p"),
                asset_type="COLLATERAL",
            )

        self.assertEqual(result["updated"], True)
        self.assertEqual(result["asset_type"], "COLLATERAL")


if __name__ == "__main__":
    unittest.main()
