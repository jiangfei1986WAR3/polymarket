from __future__ import annotations

import getpass
import importlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .polymarket_trading import (
    PolymarketApiCreds,
    PolymarketBalanceAllowanceResult,
    PolymarketSessionStatus,
    PolymarketTradingClient,
    PolymarketTradingSessionConfig,
)

PrivateKeyPrompt = Callable[[str], str]


@dataclass(frozen=True)
class PolymarketBridgeStatus:
    sdk_available: bool
    sdk_module: str
    private_key_source: str
    private_key_present: bool
    ready_for_l1: bool
    ready_for_l2: bool
    can_attempt_derive_l2: bool


class PolymarketSessionBridge:
    def __init__(self, base_config: PolymarketTradingSessionConfig | None = None) -> None:
        self._base_config = base_config or PolymarketTradingSessionConfig()

    @property
    def base_config(self) -> PolymarketTradingSessionConfig:
        return self._base_config

    @staticmethod
    def from_json(path: str | Path) -> "PolymarketSessionBridge":
        raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        creds = PolymarketApiCreds(**raw.get("creds", {}))
        cfg_fields = dict(raw)
        cfg_fields["creds"] = creds
        return PolymarketSessionBridge(PolymarketTradingSessionConfig(**cfg_fields))

    def resolve_private_key(
        self,
        *,
        explicit_private_key: str = "",
        env_var: str = "POLYMARKET_PRIVATE_KEY",
        allow_prompt: bool = False,
        prompt_fn: PrivateKeyPrompt | None = None,
    ) -> tuple[str, str]:
        if explicit_private_key:
            return explicit_private_key, "explicit"

        env_value = os.environ.get(env_var, "")
        if env_value:
            return env_value, f"env:{env_var}"

        if allow_prompt:
            prompt = prompt_fn or getpass.getpass
            value = prompt("Input Polymarket private key for this session: ").strip()
            if value:
                return value, "prompt"

        return "", "missing"

    def build_runtime_config(
        self,
        *,
        private_key: str,
        wallet_address: str | None = None,
        funder_address: str | None = None,
        creds: PolymarketApiCreds | None = None,
    ) -> PolymarketTradingSessionConfig:
        return PolymarketTradingSessionConfig(
            clob_base_url=self._base_config.clob_base_url,
            chain_id=self._base_config.chain_id,
            signature_type=self._base_config.signature_type,
            funder_address=funder_address if funder_address is not None else self._base_config.funder_address,
            wallet_address=wallet_address if wallet_address is not None else self._base_config.wallet_address,
            private_key=private_key,
            creds=creds if creds is not None else self._base_config.creds,
        )

    def build_trading_client(
        self,
        *,
        private_key: str,
        wallet_address: str | None = None,
        funder_address: str | None = None,
        creds: PolymarketApiCreds | None = None,
    ) -> PolymarketTradingClient:
        return PolymarketTradingClient(
            self.build_runtime_config(
                private_key=private_key,
                wallet_address=wallet_address,
                funder_address=funder_address,
                creds=creds,
            )
        )

    def bridge_status(self, *, private_key_source: str = "missing", runtime_status: PolymarketSessionStatus | None = None) -> PolymarketBridgeStatus:
        sdk_available, sdk_module = self._sdk_info()
        status = runtime_status or PolymarketTradingClient(self._base_config).session_status()
        return PolymarketBridgeStatus(
            sdk_available=sdk_available,
            sdk_module=sdk_module,
            private_key_source=private_key_source,
            private_key_present=status.private_key_present,
            ready_for_l1=status.ready_for_l1,
            ready_for_l2=status.ready_for_l2,
            can_attempt_derive_l2=sdk_available and status.ready_for_l1,
        )

    def try_derive_api_creds(
        self,
        *,
        private_key: str,
        wallet_address: str | None = None,
        funder_address: str | None = None,
    ) -> PolymarketApiCreds:
        client_cls, module_name = self._load_clob_client_class()
        if client_cls is None:
            raise RuntimeError("Polymarket SDK is not available. Install a compatible py-clob-client package first.")
        runtime_cfg = self.build_runtime_config(
            private_key=private_key,
            wallet_address=wallet_address,
            funder_address=funder_address,
        )
        client = self._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg)
        method = getattr(client, "create_or_derive_api_key", None)
        if callable(method):
            raw = method()
            return self._normalize_api_creds(raw)
        raise RuntimeError(f"Compatible ClobClient loaded from {module_name}, but create_or_derive_api_key was not found.")

    def try_get_balance_allowance(
        self,
        *,
        private_key: str,
        wallet_address: str | None = None,
        funder_address: str | None = None,
        creds: PolymarketApiCreds,
        asset_type: str,
        token_id: str | None = None,
    ) -> PolymarketBalanceAllowanceResult:
        client_cls, module_name = self._load_clob_client_class()
        if client_cls is None:
            raise RuntimeError("Polymarket SDK is not available. Install a compatible py-clob-client package first.")
        runtime_cfg = self.build_runtime_config(
            private_key=private_key,
            wallet_address=wallet_address,
            funder_address=funder_address,
            creds=creds,
        )
        client = self._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg)
        params = self._build_balance_allowance_params(asset_type=asset_type, token_id=token_id, signature_type=runtime_cfg.signature_type)
        method = getattr(client, "get_balance_allowance", None)
        if not callable(method):
            raise RuntimeError(f"Compatible ClobClient loaded from {module_name}, but get_balance_allowance was not found.")
        raw = method(params)
        return self._normalize_balance_allowance(raw, asset_type=asset_type, token_id=token_id)

    def try_update_balance_allowance(
        self,
        *,
        private_key: str,
        wallet_address: str | None = None,
        funder_address: str | None = None,
        creds: PolymarketApiCreds,
        asset_type: str,
        token_id: str | None = None,
    ) -> dict[str, Any]:
        client_cls, module_name = self._load_clob_client_class()
        if client_cls is None:
            raise RuntimeError("Polymarket SDK is not available. Install a compatible py-clob-client package first.")
        runtime_cfg = self.build_runtime_config(
            private_key=private_key,
            wallet_address=wallet_address,
            funder_address=funder_address,
            creds=creds,
        )
        client = self._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg)
        params = self._build_balance_allowance_params(asset_type=asset_type, token_id=token_id, signature_type=runtime_cfg.signature_type)
        method = getattr(client, "update_balance_allowance", None)
        if not callable(method):
            raise RuntimeError(f"Compatible ClobClient loaded from {module_name}, but update_balance_allowance was not found.")
        raw = method(params)
        return self._safe_object_to_dict(raw)

    @staticmethod
    def _normalize_api_creds(raw: Any) -> PolymarketApiCreds:
        if isinstance(raw, PolymarketApiCreds):
            return raw
        if isinstance(raw, dict):
            return PolymarketApiCreds(
                key=str(raw.get("key", raw.get("api_key", raw.get("apiKey", "")))),
                secret=str(raw.get("secret", raw.get("api_secret", ""))),
                passphrase=str(raw.get("passphrase", raw.get("api_passphrase", ""))),
            )
        key = str(getattr(raw, "key", getattr(raw, "api_key", getattr(raw, "apiKey", ""))))
        secret = str(getattr(raw, "secret", getattr(raw, "api_secret", "")))
        passphrase = str(getattr(raw, "passphrase", getattr(raw, "api_passphrase", "")))
        return PolymarketApiCreds(key=key, secret=secret, passphrase=passphrase)

    @staticmethod
    def _normalize_balance_allowance(raw: Any, *, asset_type: str, token_id: str | None) -> PolymarketBalanceAllowanceResult:
        if isinstance(raw, PolymarketBalanceAllowanceResult):
            return raw
        if isinstance(raw, dict):
            allowance_value = raw.get("allowance")
            if allowance_value is None and isinstance(raw.get("allowances"), dict):
                allowance_value = next(iter(raw["allowances"].values()), "")
            return PolymarketBalanceAllowanceResult(
                asset_type=asset_type,
                token_id=token_id,
                balance=str(raw.get("balance", raw.get("available", raw.get("balanceAvailable", "")))),
                allowance=str(allowance_value if allowance_value is not None else ""),
                raw=raw,
            )
        raw_dict = PolymarketSessionBridge._safe_object_to_dict(raw)
        allowance_value = raw_dict.get("allowance")
        if allowance_value is None and isinstance(raw_dict.get("allowances"), dict):
            allowance_value = next(iter(raw_dict["allowances"].values()), "")
        return PolymarketBalanceAllowanceResult(
            asset_type=asset_type,
            token_id=token_id,
            balance=str(raw_dict.get("balance", raw_dict.get("available", raw_dict.get("balanceAvailable", "")))),
            allowance=str(allowance_value if allowance_value is not None else ""),
            raw=raw_dict,
        )

    @staticmethod
    def _safe_object_to_dict(raw: Any) -> dict[str, Any]:
        if raw is None:
            return {}
        if isinstance(raw, dict):
            return raw
        if hasattr(raw, "__dict__"):
            return {k: v for k, v in vars(raw).items() if not k.startswith("_")}
        return {"repr": repr(raw)}

    def _create_sdk_client(self, *, client_cls: type[Any], runtime_cfg: PolymarketTradingSessionConfig) -> Any:
        kwargs: dict[str, Any] = {
            "host": runtime_cfg.clob_base_url,
            "chain_id": runtime_cfg.chain_id,
            "key": runtime_cfg.private_key,
            "signature_type": runtime_cfg.signature_type,
        }
        creds_key = getattr(runtime_cfg.creds, "key", None) or getattr(runtime_cfg.creds, "api_key", None)
        creds_secret = getattr(runtime_cfg.creds, "secret", None) or getattr(runtime_cfg.creds, "api_secret", None)
        creds_passphrase = getattr(runtime_cfg.creds, "passphrase", None) or getattr(runtime_cfg.creds, "api_passphrase", None)
        if creds_key and creds_secret and creds_passphrase:
            api_creds_cls = self._load_api_creds_class()
            if api_creds_cls is not None:
                kwargs["creds"] = api_creds_cls(
                    api_key=creds_key,
                    api_secret=creds_secret,
                    api_passphrase=creds_passphrase,
                )
        if runtime_cfg.funder_address:
            kwargs["funder"] = runtime_cfg.funder_address
        return client_cls(**kwargs)

    def _build_balance_allowance_params(self, *, asset_type: str, token_id: str | None, signature_type: int) -> Any:
        params_cls = self._load_balance_allowance_params_class()
        asset_enum = self._load_asset_type_value(asset_type)
        if params_cls is None:
            raise RuntimeError("Installed SDK does not expose BalanceAllowanceParams.")
        return params_cls(asset_type=asset_enum, token_id=token_id, signature_type=signature_type)

    @staticmethod
    def _sdk_candidates() -> tuple[tuple[str, str], ...]:
        return (
            ("py_clob_client_v2.client", "ClobClient"),
            ("py_clob_client.client", "ClobClient"),
        )

    def _sdk_info(self) -> tuple[bool, str]:
        client_cls, module_name = self._load_clob_client_class()
        return client_cls is not None, module_name

    def _load_clob_client_class(self) -> tuple[type[Any] | None, str]:
        for module_name, attr_name in self._sdk_candidates():
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            client_cls = getattr(module, attr_name, None)
            if client_cls is not None:
                return client_cls, module_name
        return None, ""

    @staticmethod
    def _load_api_creds_class() -> type[Any] | None:
        for module_name in ("py_clob_client_v2.clob_types", "py_clob_client.clob_types"):
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            api_creds_cls = getattr(module, "ApiCreds", None)
            if api_creds_cls is not None:
                return api_creds_cls
        return None

    @staticmethod
    def _load_balance_allowance_params_class() -> type[Any] | None:
        for module_name in ("py_clob_client_v2.clob_types", "py_clob_client.clob_types"):
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            params_cls = getattr(module, "BalanceAllowanceParams", None)
            if params_cls is not None:
                return params_cls
        return None

    @staticmethod
    def _load_asset_type_value(asset_type: str) -> Any:
        normalized = asset_type.strip().upper()
        for module_name in ("py_clob_client_v2.clob_types", "py_clob_client.clob_types"):
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            asset_type_cls = getattr(module, "AssetType", None)
            if asset_type_cls is None:
                continue
            value = getattr(asset_type_cls, normalized, None)
            if value is not None:
                return value
        raise RuntimeError(f"Unsupported asset type for installed SDK: {asset_type}")
