from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class PolymarketPublicClientConfig:
    gamma_base_url: str = "https://gamma-api.polymarket.com"
    clob_base_url: str = "https://clob.polymarket.com"
    chain_id: int = 137
    timeout_s: float = 10.0


@dataclass(frozen=True)
class PolymarketMarketLookup:
    market_id: str
    question: str
    slug: str
    active: bool
    closed: bool
    enable_order_book: bool
    clob_token_ids: tuple[str, ...]
    outcomes: tuple[str, ...]
    outcome_prices: tuple[str, ...]


@dataclass(frozen=True)
class PolymarketBookLevel:
    price: str
    size: str


@dataclass(frozen=True)
class PolymarketOrderBook:
    market: str
    asset_id: str
    timestamp: str
    bids: tuple[PolymarketBookLevel, ...]
    asks: tuple[PolymarketBookLevel, ...]
    min_order_size: str
    tick_size: str
    neg_risk: bool
    hash: str


class PolymarketPublicClient:
    def __init__(self, config: PolymarketPublicClientConfig | None = None) -> None:
        self._config = config or PolymarketPublicClientConfig()

    @property
    def config(self) -> PolymarketPublicClientConfig:
        return self._config

    @staticmethod
    def from_json(path: str | Path) -> "PolymarketPublicClient":
        raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        return PolymarketPublicClient(PolymarketPublicClientConfig(**raw))

    def _fetch_json(self, base_url: str, path: str, params: dict[str, Any] | None = None) -> Any:
        query = f"?{urlencode(params, doseq=True)}" if params else ""
        url = f"{base_url.rstrip('/')}{path}{query}"
        req = Request(url, headers={"Accept": "application/json", "User-Agent": "martingale-research/0.1"})
        with urlopen(req, timeout=self._config.timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_ok(self) -> Any:
        return self._fetch_json(self._config.clob_base_url, "/ok")

    def get_server_time(self) -> Any:
        return self._fetch_json(self._config.clob_base_url, "/time")

    def get_markets(self, *, limit: int = 10, active: bool | None = None, closed: bool | None = None) -> Any:
        params: dict[str, Any] = {"limit": limit}
        if active is not None:
            params["active"] = str(active).lower()
        if closed is not None:
            params["closed"] = str(closed).lower()
        return self._fetch_json(self._config.gamma_base_url, "/markets", params)

    def get_market_by_id(self, market_id: str) -> Any:
        return self._fetch_json(self._config.gamma_base_url, f"/markets/{market_id}")

    def get_market_by_slug(self, slug: str) -> Any:
        return self._fetch_json(self._config.gamma_base_url, "/markets", {"slug": slug, "limit": 1})

    def get_price(self, token_id: str, side: str = "BUY") -> Any:
        return self._fetch_json(self._config.clob_base_url, "/price", {"token_id": token_id, "side": side})

    def get_midpoint(self, token_id: str) -> Any:
        return self._fetch_json(self._config.clob_base_url, "/midpoint", {"token_id": token_id})

    def get_spread(self, token_id: str) -> Any:
        return self._fetch_json(self._config.clob_base_url, "/spread", {"token_id": token_id})

    def get_order_book(self, token_id: str) -> Any:
        return self._fetch_json(self._config.clob_base_url, "/book", {"token_id": token_id})

    def lookup_market_by_slug(self, slug: str) -> PolymarketMarketLookup | None:
        raw = self.get_market_by_slug(slug)
        if isinstance(raw, list):
            if not raw:
                return None
            item = raw[0]
        else:
            data = raw.get("data") if isinstance(raw, dict) else None
            if isinstance(data, list) and data:
                item = data[0]
            else:
                return None
        return self._parse_market_lookup(item)

    def get_first_active_market(self) -> PolymarketMarketLookup | None:
        raw = self.get_markets(limit=1, active=True, closed=False)
        if not isinstance(raw, list) or not raw:
            return None
        return self._parse_market_lookup(raw[0])

    def order_book_summary(self, token_id: str) -> PolymarketOrderBook:
        return self._parse_order_book(self.get_order_book(token_id))

    @staticmethod
    def _parse_market_lookup(item: dict[str, Any]) -> PolymarketMarketLookup:
        clob_token_ids_raw = item.get("clobTokenIds") or item.get("clob_token_ids") or []
        if isinstance(clob_token_ids_raw, str):
            try:
                clob_token_ids = tuple(str(x) for x in json.loads(clob_token_ids_raw))
            except json.JSONDecodeError:
                clob_token_ids = tuple()
        else:
            clob_token_ids = tuple(str(x) for x in clob_token_ids_raw)

        outcomes_raw = item.get("outcomes") or []
        if isinstance(outcomes_raw, str):
            try:
                outcomes = tuple(str(x) for x in json.loads(outcomes_raw))
            except json.JSONDecodeError:
                outcomes = tuple()
        else:
            outcomes = tuple(str(x) for x in outcomes_raw)

        prices_raw = item.get("outcomePrices") or item.get("outcome_prices") or []
        if isinstance(prices_raw, str):
            try:
                prices = tuple(str(x) for x in json.loads(prices_raw))
            except json.JSONDecodeError:
                prices = tuple()
        else:
            prices = tuple(str(x) for x in prices_raw)

        return PolymarketMarketLookup(
            market_id=str(item.get("id", "")),
            question=str(item.get("question", "")),
            slug=str(item.get("slug", item.get("market_slug", ""))),
            active=bool(item.get("active", False)),
            closed=bool(item.get("closed", False)),
            enable_order_book=bool(item.get("enableOrderBook", item.get("enable_order_book", False))),
            clob_token_ids=clob_token_ids,
            outcomes=outcomes,
            outcome_prices=prices,
        )

    @staticmethod
    def _parse_order_book(item: dict[str, Any]) -> PolymarketOrderBook:
        def _levels(rows: list[dict[str, Any]]) -> tuple[PolymarketBookLevel, ...]:
            return tuple(
                PolymarketBookLevel(
                    price=str(row.get("price", "")),
                    size=str(row.get("size", "")),
                )
                for row in rows
            )

        return PolymarketOrderBook(
            market=str(item.get("market", "")),
            asset_id=str(item.get("asset_id", "")),
            timestamp=str(item.get("timestamp", "")),
            bids=_levels(list(item.get("bids", []))),
            asks=_levels(list(item.get("asks", []))),
            min_order_size=str(item.get("min_order_size", "")),
            tick_size=str(item.get("tick_size", "")),
            neg_risk=bool(item.get("neg_risk", False)),
            hash=str(item.get("hash", "")),
        )
