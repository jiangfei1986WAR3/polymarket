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

from martingale_research.data.candles import Candle  # noqa: E402
from martingale_research.execution import (  # noqa: E402
    AllowedStatesBundle,
    DryRunExecutionAdapter,
    StrategyConfig,
    make_default_state,
    process_available_candles,
)


def _make_candles_from_dirs(dirs: list[bool], start_time_ms: int = 0) -> list[Candle]:
    out: list[Candle] = []
    t = start_time_ms
    for d in dirs:
        o = 100.0
        c = 101.0 if d else 99.0
        out.append(Candle(open_time_ms=t, open=o, high=max(o, c), low=min(o, c), close=c, volume=1.0))
        t += 3600_000
    return out


class TestDaemon(unittest.TestCase):
    def setUp(self) -> None:
        self.strategy = StrategyConfig(
            version="demo",
            pattern="UUUUUU",
            coverage_target=0.15,
            risk_horizon_h=72,
            train_window_days=365,
            step_days=7,
            base_stake_u=2.0,
            max_steps=6,
            allowed_states_count=1,
        )
        self.allowed = AllowedStatesBundle(
            version="demo",
            pattern="UUUUUU",
            coverage_target=0.15,
            allowed_states=frozenset({"DDDDDD"}),
        )

    def test_bootstrap_processes_latest_candle_once(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False])
        state = make_default_state(strategy_version="demo")

        with tempfile.TemporaryDirectory() as tmp:
            adapter = DryRunExecutionAdapter(Path(tmp) / "broker.jsonl")
            report = process_available_candles(
                candles=candles,
                strategy=self.strategy,
                allowed_states=self.allowed,
                state=state,
                adapter=adapter,
            )

        self.assertEqual(report.mode, "bootstrap")
        self.assertEqual(report.processed_count, 1)
        self.assertEqual(report.state.last_processed_candle_open_time_ms, candles[-1].open_time_ms)
        self.assertTrue(report.state.in_run)

    def test_idle_when_no_new_candle(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False])
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=False,
            current_step=None,
            last_processed_candle_open_time_ms=candles[-1].open_time_ms,
            last_state="DDDDDD",
            last_action="BLOCK",
            last_direction=None,
            last_reason="done",
            updated_at_utc="",
            total_runs_started=0,
            total_wins=0,
            total_losses=0,
            total_blowups=0,
        )

        with tempfile.TemporaryDirectory() as tmp:
            adapter = DryRunExecutionAdapter(Path(tmp) / "broker.jsonl")
            report = process_available_candles(
                candles=candles,
                strategy=self.strategy,
                allowed_states=self.allowed,
                state=state,
                adapter=adapter,
            )

        self.assertEqual(report.mode, "idle")
        self.assertEqual(report.processed_count, 0)

    def test_new_candle_resolves_previous_bet_and_logs_event(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False, True])
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=1,
            last_processed_candle_open_time_ms=candles[-2].open_time_ms,
            last_state="DDDDDD",
            last_action="START_RUN",
            last_direction="U",
            last_reason="started",
            updated_at_utc="",
            total_runs_started=1,
            total_wins=0,
            total_losses=0,
            total_blowups=0,
        )

        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "broker.jsonl"
            adapter = DryRunExecutionAdapter(log_path)
            report = process_available_candles(
                candles=candles,
                strategy=self.strategy,
                allowed_states=self.allowed,
                state=state,
                adapter=adapter,
            )
            lines = log_path.read_text(encoding="utf-8").strip().splitlines() if log_path.exists() else []

        self.assertEqual(report.mode, "process_new_candles")
        self.assertEqual(report.processed_count, 1)
        self.assertEqual(report.reports[0].resolved_outcome, "win")
        self.assertEqual(report.reports[0].action, "BLOCK")
        self.assertEqual(report.state.total_wins, 1)
        self.assertEqual(len(lines), 0)

    def test_new_candle_can_advance_and_emit_dry_run_event(self) -> None:
        candles = _make_candles_from_dirs([False, False, False, False, False, False, False])
        state = make_default_state(strategy_version="demo")
        state = state.__class__(
            strategy_version=state.strategy_version,
            in_run=True,
            current_step=1,
            last_processed_candle_open_time_ms=candles[-2].open_time_ms,
            last_state="DDDDDD",
            last_action="START_RUN",
            last_direction="U",
            last_reason="started",
            updated_at_utc="",
            total_runs_started=1,
            total_wins=0,
            total_losses=0,
            total_blowups=0,
        )

        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "broker.jsonl"
            adapter = DryRunExecutionAdapter(log_path)
            report = process_available_candles(
                candles=candles,
                strategy=self.strategy,
                allowed_states=self.allowed,
                state=state,
                adapter=adapter,
            )
            lines = log_path.read_text(encoding="utf-8").strip().splitlines()
            event = json.loads(lines[0])

        self.assertEqual(report.reports[0].resolved_outcome, "loss")
        self.assertEqual(report.reports[0].action, "BET_STEP_2")
        self.assertEqual(report.state.current_step, 2)
        self.assertEqual(report.state.total_losses, 1)
        self.assertEqual(len(lines), 1)
        self.assertEqual(event["action"], "BET_STEP_2")
        self.assertEqual(event["direction"], "U")


if __name__ == "__main__":
    unittest.main()
