from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from .decision_engine import DecisionReport


@dataclass(frozen=True)
class BrokerEvent:
    created_at_utc: str
    target_candle_open_time_ms: int
    action: str
    direction: str | None
    strategy_version: str
    pattern: str
    current_state: str
    reason: str


@dataclass(frozen=True)
class PolymarketConnectionConfig:
    clob_base_url: str
    chain_id: int
    api_key: str = ""
    api_secret: str = ""
    api_passphrase: str = ""
    wallet_address: str = ""


@dataclass(frozen=True)
class PolymarketMarketConfig:
    market_slug: str
    market_name: str
    up_token_id: str
    down_token_id: str
    order_price: float
    max_order_size: float


@dataclass(frozen=True)
class PolymarketPreparedOrder:
    created_at_utc: str
    strategy_version: str
    market_slug: str
    market_name: str
    target_candle_open_time_ms: int
    decision_action: str
    pattern: str
    current_state: str
    martingale_step: int
    direction_ud: str
    side_yes_no: str
    token_id: str
    price: float
    size: float
    wallet_address: str
    clob_base_url: str
    reason: str


class ExecutionAdapter:
    def handle_decision(self, *, decision: DecisionReport, target_candle_open_time_ms: int) -> BrokerEvent | None:
        raise NotImplementedError


class DryRunExecutionAdapter(ExecutionAdapter):
    def __init__(self, log_path: str | Path) -> None:
        self._log_path = Path(log_path)

    def handle_decision(self, *, decision: DecisionReport, target_candle_open_time_ms: int) -> BrokerEvent | None:
        if decision.recommended_action == "BLOCK":
            return None

        event = BrokerEvent(
            created_at_utc=datetime.now(timezone.utc).isoformat(),
            target_candle_open_time_ms=target_candle_open_time_ms,
            action=decision.recommended_action,
            direction=decision.next_direction,
            strategy_version=decision.version,
            pattern=decision.pattern,
            current_state=decision.current_state,
            reason=decision.reason,
        )
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(event), ensure_ascii=True) + "\n")
        return event


class PolymarketExecutionAdapter(ExecutionAdapter):
    def __init__(
        self,
        *,
        connection: PolymarketConnectionConfig,
        market: PolymarketMarketConfig,
        log_path: str | Path,
    ) -> None:
        self._connection = connection
        self._market = market
        self._log_path = Path(log_path)

    @staticmethod
    def from_json(config_path: str | Path, *, log_path: str | Path) -> "PolymarketExecutionAdapter":
        raw = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
        connection = PolymarketConnectionConfig(**raw["connection"])
        market = PolymarketMarketConfig(**raw["market"])
        return PolymarketExecutionAdapter(connection=connection, market=market, log_path=log_path)

    def connection_status(self) -> dict[str, object]:
        return {
            "clob_base_url": self._connection.clob_base_url,
            "chain_id": self._connection.chain_id,
            "wallet_address_present": bool(self._connection.wallet_address),
            "api_key_present": bool(self._connection.api_key),
            "api_secret_present": bool(self._connection.api_secret),
            "api_passphrase_present": bool(self._connection.api_passphrase),
        }

    def _step_from_action(self, action: str) -> int:
        if action == "START_RUN":
            return 1
        if action.startswith("BET_STEP_"):
            return int(action.removeprefix("BET_STEP_"))
        raise ValueError(f"unsupported action for Polymarket order prep: {action}")

    def _direction_to_token(self, direction_ud: str) -> tuple[str, str]:
        if direction_ud == "U":
            return ("YES", self._market.up_token_id)
        if direction_ud == "D":
            return ("NO", self._market.down_token_id)
        raise ValueError(f"unsupported direction_ud: {direction_ud}")

    def prepare_order(self, *, decision: DecisionReport, target_candle_open_time_ms: int) -> PolymarketPreparedOrder:
        if decision.recommended_action == "BLOCK" or decision.next_direction is None:
            raise ValueError("BLOCK decision cannot be converted to Polymarket order")

        side_yes_no, token_id = self._direction_to_token(decision.next_direction)
        martingale_step = self._step_from_action(decision.recommended_action)
        size = self._market.max_order_size
        return PolymarketPreparedOrder(
            created_at_utc=datetime.now(timezone.utc).isoformat(),
            strategy_version=decision.version,
            market_slug=self._market.market_slug,
            market_name=self._market.market_name,
            target_candle_open_time_ms=target_candle_open_time_ms,
            decision_action=decision.recommended_action,
            pattern=decision.pattern,
            current_state=decision.current_state,
            martingale_step=martingale_step,
            direction_ud=decision.next_direction,
            side_yes_no=side_yes_no,
            token_id=token_id,
            price=self._market.order_price,
            size=size,
            wallet_address=self._connection.wallet_address,
            clob_base_url=self._connection.clob_base_url,
            reason=decision.reason,
        )

    def handle_decision(self, *, decision: DecisionReport, target_candle_open_time_ms: int) -> BrokerEvent | None:
        if decision.recommended_action == "BLOCK":
            return None

        prepared = self.prepare_order(
            decision=decision,
            target_candle_open_time_ms=target_candle_open_time_ms,
        )
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(prepared), ensure_ascii=True) + "\n")

        return BrokerEvent(
            created_at_utc=prepared.created_at_utc,
            target_candle_open_time_ms=prepared.target_candle_open_time_ms,
            action=prepared.decision_action,
            direction=prepared.direction_ud,
            strategy_version=prepared.strategy_version,
            pattern=prepared.pattern,
            current_state=prepared.current_state,
            reason=prepared.reason,
        )
