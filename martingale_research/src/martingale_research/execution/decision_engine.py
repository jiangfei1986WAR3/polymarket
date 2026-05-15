from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from martingale_research.data.candles import Candle


@dataclass(frozen=True)
class StrategyConfig:
    version: str
    pattern: str
    coverage_target: float
    risk_horizon_h: int
    train_window_days: int
    step_days: int
    base_stake_u: float
    max_steps: int
    allowed_states_count: int


@dataclass(frozen=True)
class AllowedStatesBundle:
    version: str
    pattern: str
    coverage_target: float
    allowed_states: frozenset[str]


@dataclass(frozen=True)
class DecisionReport:
    version: str
    pattern: str
    current_state: str
    is_allowed: bool
    in_run: bool
    current_step: int | None
    next_step: int | None
    next_direction: str | None
    recommended_action: str
    reason: str


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_strategy_bundle(strategy_dir: str | Path) -> tuple[StrategyConfig, AllowedStatesBundle]:
    base = Path(strategy_dir)
    cfg_data = _read_json(base / "strategy_config.json")
    allowed_data = _read_json(base / "allowed_states.json")

    cfg = StrategyConfig(
        version=str(cfg_data["version"]),
        pattern=str(cfg_data["pattern"]),
        coverage_target=float(cfg_data["coverage_target"]),
        risk_horizon_h=int(cfg_data["risk_horizon_h"]),
        train_window_days=int(cfg_data["train_window_days"]),
        step_days=int(cfg_data["step_days"]),
        base_stake_u=float(cfg_data["base_stake_u"]),
        max_steps=int(cfg_data["max_steps"]),
        allowed_states_count=int(cfg_data["allowed_states_count"]),
    )
    allowed = AllowedStatesBundle(
        version=str(allowed_data["version"]),
        pattern=str(allowed_data["pattern"]),
        coverage_target=float(allowed_data["coverage_target"]),
        allowed_states=frozenset(str(x) for x in allowed_data["allowed_states"]),
    )

    if cfg.version != allowed.version:
        raise ValueError("strategy_config and allowed_states version mismatch")
    if cfg.pattern != allowed.pattern:
        raise ValueError("strategy_config and allowed_states pattern mismatch")

    return (cfg, allowed)


def recent_state_str(candles: list[Candle], state_len: int = 6) -> str:
    if state_len <= 0:
        raise ValueError("state_len must be positive")
    if len(candles) < state_len:
        raise ValueError("not enough candles to compute current state")

    out = []
    for c in candles[-state_len:]:
        out.append("U" if c.close >= c.open else "D")
    return "".join(out)


def _pattern_direction(pattern: str, step: int) -> str:
    if step < 1 or step > len(pattern):
        raise ValueError("step out of range")
    return pattern[step - 1]


def evaluate_decision(
    *,
    candles: list[Candle],
    strategy: StrategyConfig,
    allowed_states: AllowedStatesBundle,
    current_step: int | None = None,
) -> DecisionReport:
    if current_step is not None and (current_step < 1 or current_step > strategy.max_steps):
        raise ValueError("current_step must be between 1 and max_steps")

    current_state = recent_state_str(candles)
    is_allowed = current_state in allowed_states.allowed_states
    in_run = current_step is not None

    if in_run:
        next_direction = _pattern_direction(strategy.pattern, current_step)
        return DecisionReport(
            version=strategy.version,
            pattern=strategy.pattern,
            current_state=current_state,
            is_allowed=is_allowed,
            in_run=True,
            current_step=current_step,
            next_step=current_step,
            next_direction=next_direction,
            recommended_action=f"BET_STEP_{current_step}",
            reason="当前已经处于一轮马丁中，继续按固定 pattern 执行当前步。",
        )

    if not is_allowed:
        return DecisionReport(
            version=strategy.version,
            pattern=strategy.pattern,
            current_state=current_state,
            is_allowed=False,
            in_run=False,
            current_step=None,
            next_step=None,
            next_direction=None,
            recommended_action="BLOCK",
            reason="当前最近 6 根K线形成的 state 不在 allowed_states 白名单内。",
        )

    next_direction = _pattern_direction(strategy.pattern, 1)
    return DecisionReport(
        version=strategy.version,
        pattern=strategy.pattern,
        current_state=current_state,
        is_allowed=True,
        in_run=False,
        current_step=None,
        next_step=1,
        next_direction=next_direction,
        recommended_action="START_RUN",
        reason="当前 state 在 allowed_states 白名单内，允许启动新一轮马丁。",
    )
