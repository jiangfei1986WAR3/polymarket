from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .adapters import PolymarketPreparedOrder


@dataclass(frozen=True)
class PolymarketApiCreds:
    key: str = ""
    secret: str = ""
    passphrase: str = ""


@dataclass(frozen=True)
class PolymarketTradingSessionConfig:
    clob_base_url: str = "https://clob.polymarket.com"
    chain_id: int = 137
    signature_type: int = 0
    funder_address: str = ""
    wallet_address: str = ""
    private_key: str = ""
    creds: PolymarketApiCreds = PolymarketApiCreds()


@dataclass(frozen=True)
class PolymarketOrderRequest:
    request_type: str
    method: str
    path: str
    requires_l1: bool
    requires_l2: bool
    payload: dict[str, Any]


@dataclass(frozen=True)
class PolymarketSessionStatus:
    clob_base_url: str
    chain_id: int
    signature_type: int
    wallet_address_present: bool
    funder_address_present: bool
    private_key_present: bool
    api_key_present: bool
    api_secret_present: bool
    api_passphrase_present: bool
    ready_for_l1: bool
    ready_for_l2: bool


@dataclass(frozen=True)
class PolymarketBalanceAllowanceResult:
    asset_type: str
    token_id: str | None
    balance: str
    allowance: str
    raw: dict[str, Any]


class PolymarketTradingClient:
    def __init__(self, config: PolymarketTradingSessionConfig | None = None) -> None:
        self._config = config or PolymarketTradingSessionConfig()

    @property
    def config(self) -> PolymarketTradingSessionConfig:
        return self._config

    @staticmethod
    def from_json(path: str | Path) -> "PolymarketTradingClient":
        raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        creds = PolymarketApiCreds(**raw.get("creds", {}))
        cfg_fields = dict(raw)
        cfg_fields["creds"] = creds
        return PolymarketTradingClient(PolymarketTradingSessionConfig(**cfg_fields))

    def session_status(self) -> PolymarketSessionStatus:
        private_key_present = bool(self._config.private_key)
        api_key_present = bool(self._config.creds.key)
        api_secret_present = bool(self._config.creds.secret)
        api_passphrase_present = bool(self._config.creds.passphrase)
        wallet_present = bool(self._config.wallet_address)
        funder_present = bool(self._config.funder_address)
        ready_for_l1 = private_key_present
        ready_for_l2 = ready_for_l1 and api_key_present and api_secret_present and api_passphrase_present and funder_present
        return PolymarketSessionStatus(
            clob_base_url=self._config.clob_base_url,
            chain_id=self._config.chain_id,
            signature_type=self._config.signature_type,
            wallet_address_present=wallet_present,
            funder_address_present=funder_present,
            private_key_present=private_key_present,
            api_key_present=api_key_present,
            api_secret_present=api_secret_present,
            api_passphrase_present=api_passphrase_present,
            ready_for_l1=ready_for_l1,
            ready_for_l2=ready_for_l2,
        )

    def build_create_or_derive_api_key_request(self, *, nonce: int | None = None) -> PolymarketOrderRequest:
        payload: dict[str, Any] = {}
        if nonce is not None:
            payload["nonce"] = nonce
        return PolymarketOrderRequest(
            request_type="create_or_derive_api_key",
            method="POST",
            path="/auth/api-key",
            requires_l1=True,
            requires_l2=False,
            payload=payload,
        )

    def build_balance_allowance_request(self, *, asset_type: str, token_id: str | None = None) -> PolymarketOrderRequest:
        payload: dict[str, Any] = {"asset_type": asset_type}
        if token_id is not None:
            payload["token_id"] = token_id
        return PolymarketOrderRequest(
            request_type="get_balance_allowance",
            method="GET",
            path="/balance-allowance",
            requires_l1=False,
            requires_l2=True,
            payload=payload,
        )

    def build_post_order_request(
        self,
        *,
        prepared_order: PolymarketPreparedOrder,
        order_type: str = "GTC",
        post_only: bool = False,
    ) -> PolymarketOrderRequest:
        payload = {
            "tokenID": prepared_order.token_id,
            "price": prepared_order.price,
            "size": prepared_order.size,
            "side": "BUY",
            "orderType": order_type,
            "postOnly": post_only,
            "marketSlug": prepared_order.market_slug,
            "marketName": prepared_order.market_name,
            "strategyVersion": prepared_order.strategy_version,
            "currentState": prepared_order.current_state,
            "martingaleStep": prepared_order.martingale_step,
            "directionUD": prepared_order.direction_ud,
            "sideYesNo": prepared_order.side_yes_no,
            "targetCandleOpenTimeMs": prepared_order.target_candle_open_time_ms,
        }
        return PolymarketOrderRequest(
            request_type="post_order",
            method="POST",
            path="/order",
            requires_l1=True,
            requires_l2=True,
            payload=payload,
        )

    def build_get_order_request(self, *, order_id: str) -> PolymarketOrderRequest:
        return PolymarketOrderRequest(
            request_type="get_order",
            method="GET",
            path=f"/data/order/{order_id}",
            requires_l1=False,
            requires_l2=True,
            payload={"order_id": order_id},
        )

    def build_cancel_order_request(self, *, order_id: str) -> PolymarketOrderRequest:
        return PolymarketOrderRequest(
            request_type="cancel_order",
            method="DELETE",
            path="/order",
            requires_l1=False,
            requires_l2=True,
            payload={"order_id": order_id},
        )

    def export_request_preview(self, request: PolymarketOrderRequest) -> str:
        return json.dumps(asdict(request), ensure_ascii=True, indent=2)
