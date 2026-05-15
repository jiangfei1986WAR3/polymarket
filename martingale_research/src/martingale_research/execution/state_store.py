from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuntimeState:
    strategy_version: str
    in_run: bool
    current_step: int | None
    last_processed_candle_open_time_ms: int | None
    last_state: str
    last_action: str
    last_direction: str | None
    last_reason: str
    updated_at_utc: str
    total_runs_started: int = 0
    total_wins: int = 0
    total_losses: int = 0
    total_blowups: int = 0


def make_default_state(*, strategy_version: str) -> RuntimeState:
    return RuntimeState(
        strategy_version=strategy_version,
        in_run=False,
        current_step=None,
        last_processed_candle_open_time_ms=None,
        last_state="",
        last_action="INIT",
        last_direction=None,
        last_reason="初始化状态。",
        updated_at_utc="",
    )


def load_runtime_state(path: str | Path, *, strategy_version: str) -> RuntimeState:
    p = Path(path)
    if not p.exists():
        return make_default_state(strategy_version=strategy_version)
    data = json.loads(p.read_text(encoding="utf-8-sig"))
    return RuntimeState(
        strategy_version=str(data["strategy_version"]),
        in_run=bool(data["in_run"]),
        current_step=(int(data["current_step"]) if data["current_step"] is not None else None),
        last_processed_candle_open_time_ms=(
            int(data["last_processed_candle_open_time_ms"])
            if data.get("last_processed_candle_open_time_ms") is not None
            else None
        ),
        last_state=str(data["last_state"]),
        last_action=str(data["last_action"]),
        last_direction=(str(data["last_direction"]) if data["last_direction"] is not None else None),
        last_reason=str(data["last_reason"]),
        updated_at_utc=str(data["updated_at_utc"]),
        total_runs_started=int(data.get("total_runs_started", 0)),
        total_wins=int(data.get("total_wins", 0)),
        total_losses=int(data.get("total_losses", 0)),
        total_blowups=int(data.get("total_blowups", 0)),
    )


def save_runtime_state(path: str | Path, state: RuntimeState) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")
