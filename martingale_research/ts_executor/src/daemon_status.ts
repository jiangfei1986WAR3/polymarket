import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { applyAppConfigFileToProcessEnv } from "./app_config.js";
import { loadExecutorConfig } from "./config.js";
import { loadRuntimeState } from "./state.js";
import type { DaemonHeartbeatSnapshot, DaemonHealthStatus, DaemonStatusSnapshot, ExecutorConfig } from "./types.js";

interface CliArgs {
  configFile?: string;
  staleAfterMs: number;
  help: boolean;
}

function nowMs(): number {
  return Date.now();
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    configFile: undefined,
    staleAfterMs: 180_000,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--config":
        out.configFile = next;
        i += 1;
        break;
      case "--stale-after-ms":
        out.staleAfterMs = Math.max(1_000, Number(next));
        i += 1;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        break;
    }
  }

  return out;
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  npm run daemon-status --");
  console.log("  npm run daemon-status -- --config .\\app_config.json");
  console.log("  npm run daemon-status -- --stale-after-ms 180000");
  console.log("");
  console.log("Notes:");
  console.log("  - Reads daemon heartbeat and runtime state.");
  console.log("  - Marks status as stale when heartbeat is too old.");
}

function safeReadHeartbeat(filePath: string): DaemonHeartbeatSnapshot | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as DaemonHeartbeatSnapshot;
}

function parseTimeMs(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function deriveHealthStatus(heartbeat: DaemonHeartbeatSnapshot | null, staleAfterMs: number): DaemonHealthStatus {
  if (!heartbeat) {
    return "never_started";
  }

  if (heartbeat.status === "error") {
    return "error";
  }
  if (heartbeat.status === "stopped") {
    return "stopped";
  }

  const updatedAtMs = parseTimeMs(heartbeat.updatedAt);
  const isStale = updatedAtMs !== null && nowMs() - updatedAtMs > staleAfterMs;
  if (isStale) {
    return "stale";
  }

  if (heartbeat.runtimePaused) {
    return "runtime_paused";
  }
  if (heartbeat.status === "starting") {
    return "starting";
  }
  if (heartbeat.status === "sleeping") {
    return "sleeping";
  }
  return "running";
}

function summarizeHeartbeatAge(heartbeat: DaemonHeartbeatSnapshot | null) {
  const updatedAtMs = parseTimeMs(heartbeat?.updatedAt ?? "");
  return {
    heartbeatPresent: Boolean(heartbeat),
    heartbeatAgeMs: updatedAtMs === null ? null : nowMs() - updatedAtMs,
    updatedAt: heartbeat?.updatedAt ?? "",
  };
}

export function getDaemonStatusSnapshot(staleAfterMs = 180_000, config = loadExecutorConfig()): DaemonStatusSnapshot {
  const heartbeat = safeReadHeartbeat(config.heartbeatFile);
  const runtimeState = loadRuntimeState(config.stateFile);
  const health = deriveHealthStatus(heartbeat, staleAfterMs);
  const heartbeatAge = summarizeHeartbeatAge(heartbeat);

  return {
    mode: "daemon_status",
    health,
    staleAfterMs,
    heartbeatFile: config.heartbeatFile,
    stateFile: config.stateFile,
    eventsLogFile: config.eventsLogFile,
    ...heartbeatAge,
    runner: heartbeat
      ? {
          pid: heartbeat.pid,
          status: heartbeat.status,
          execute: heartbeat.execute,
          commitState: heartbeat.commitState,
          intervalMs: heartbeat.intervalMs,
          tickCount: heartbeat.tickCount,
          startedAt: heartbeat.startedAt,
          lastTickStartedAt: heartbeat.lastTickStartedAt,
          lastTickFinishedAt: heartbeat.lastTickFinishedAt,
          lastSuccessfulTickAt: heartbeat.lastSuccessfulTickAt,
          lastTickMode: heartbeat.lastTickMode,
          lastError: heartbeat.lastError,
          nextWakeAt: heartbeat.nextWakeAt,
        }
      : null,
    runtime: {
      paused: runtimeState.risk.paused,
      pauseCode: runtimeState.risk.pauseCode,
      pauseReason: runtimeState.risk.pauseReason,
      lastGuardDecision: runtimeState.risk.lastGuardDecision,
      inRun: runtimeState.run.inRun,
      currentStep: runtimeState.run.currentStep,
      lastAction: runtimeState.run.lastAction,
      lastReason: runtimeState.run.lastReason,
      lastDirection: runtimeState.run.lastDirection,
      lastOrderId: runtimeState.orders.lastOrderId,
      lastOrderStatus: runtimeState.orders.lastOrderStatus,
      consecutiveApiFailures: runtimeState.risk.consecutiveApiFailures,
      consecutiveBlowups: runtimeState.risk.consecutiveBlowups,
      dailyLossU: runtimeState.risk.dailyLossU,
    },
  };
}

export async function runDaemonStatus(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }
  if (cli.configFile) {
    applyAppConfigFileToProcessEnv(cli.configFile);
  }
  console.log(JSON.stringify(getDaemonStatusSnapshot(cli.staleAfterMs), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDaemonStatus().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
