from __future__ import annotations

import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def _ensure_paths() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    scripts = root / "scripts"
    for p in (src, scripts):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


_ensure_paths()

import probe_signature_types  # noqa: E402


@dataclass(frozen=True)
class FakeConfig:
    signature_type: int = 0


class FakeBridge:
    def __init__(self, base_config) -> None:
        self.base_config = base_config

    @staticmethod
    def from_json(_path: str):
        return FakeBridge(FakeConfig())

    def resolve_private_key(self, **_kwargs):
        return "0xabc", "env:POLYMARKET_PRIVATE_KEY"

    def build_trading_client(self, **_kwargs):
        class C:
            @staticmethod
            def session_status():
                return SimpleNamespace(private_key_present=True, ready_for_l1=True, ready_for_l2=False)

        return C()

    def bridge_status(self, **_kwargs):
        return SimpleNamespace(sdk_available=True, can_attempt_derive_l2=True)

    def try_derive_api_creds(self, **_kwargs):
        return SimpleNamespace(key="k", secret="s", passphrase="p")

    def try_get_balance_allowance(self, **_kwargs):
        return SimpleNamespace(asset_type="COLLATERAL", token_id=None, balance="0", allowance="", raw={})


class TestProbeSignatureTypes(unittest.TestCase):
    def test_run_one_returns_expected_shape(self) -> None:
        args = SimpleNamespace(
            trading_config="x",
            funder_address="0xfunder",
            wallet_address="",
            private_key="",
            env_var="POLYMARKET_PRIVATE_KEY",
            prompt_private_key=False,
            asset_type="COLLATERAL",
            token_id="",
        )
        with patch.object(probe_signature_types, "PolymarketSessionBridge", FakeBridge):
            result = probe_signature_types._run_one(1, args)

        self.assertEqual(result["signature_type"], 1)
        self.assertTrue(result["derived_creds_present"])
        self.assertIn("balance_allowance", result)


if __name__ == "__main__":
    unittest.main()
