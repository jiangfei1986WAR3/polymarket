import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { applyAppConfigFileToProcessEnv } from "./app_config.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { runHourlyDaemon } from "./hourly_daemon_demo.js";
import { loadRuntimeState } from "./state.js";

interface CliArgs {
  configFile?: string;
  execute: boolean;
  intervalMs: number;
  maxTicks?: number;
  commitState: boolean;
  help: boolean;
}

interface DaemonHeartbeat {
  pid: number;
  status: "starting" | "running_tick" | "sleeping" | "stopped" | "error";
  execute: boolean;
  commitState: boolean;
  intervalMs: number;
  tickCount: number;
  startedAt: string;
  updatedAt: string;
  lastTickStartedAt: string;
  lastTickFinishedAt: string;
  lastSuccessfulTickAt: string;
  lastTickMode: string;
  lastError: string;
  nextWakeAt: string;
  runtimePaused: boolean;
  runtimePauseCode: string;
  runtimePauseReason: string;
  runtimeLastAction: string;
  runtimeCurrentStep: number | null;
  stateFile: string;
  eventsLogFile: string;
}

interface RuntimeSummary {
  paused: boolean;
  pauseCode: string;
  pauseReason: string;
  lastAction: string;
  currentStep: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    configFile: undefined,
    execute: false,
    intervalMs: 60_000,
    commitState: true,
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
      case "--execute":
        out.execute = true;
        break;
      case "--interval-ms":
        out.intervalMs = Math.max(1_000, Number(next));
        i += 1;
        break;
      case "--max-ticks":
        out.maxTicks = Math.max(1, Number(next));
        i += 1;
        break;
      case "--no-commit-state":
        out.commitState = false;
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
  console.log("  npm run daemon-runner --");
  console.log("  npm run daemon-runner -- --config .\\app_config.json");
  console.log("  npm run daemon-runner -- --max-ticks 1");
  console.log("  npm run daemon-runner -- --interval-ms 30000");
  console.log("  npm run daemon-runner -- --execute");
  console.log("");
  console.log("Notes:");
  console.log("  - Runner defaults to dry-run with state commits enabled.");
  console.log("  - Use --execute to submit real orders.");
  console.log("  - Use --max-ticks for bounded test runs.");
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stopRequested(stopFile: string): boolean {
  return fs.existsSync(stopFile);
}

async function sleepUntilNextTick(ms: number, stopFile: string): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (stopRequested(stopFile)) {
      return true;
    }
    const remaining = deadline - Date.now();
    await sleep(Math.min(500, Math.max(50, remaining)));
  }
  return stopRequested(stopFile);
}

function buildHeartbeat(args: {
  status: DaemonHeartbeat["status"];
  execute: boolean;
  commitState: boolean;
  intervalMs: number;
  tickCount: number;
  startedAt: string;
  stateFile: string;
  eventsLogFile: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastSuccessfulTickAt?: string;
  lastTickMode?: string;
  lastError?: string;
  nextWakeAt?: string;
  runtimeSummary?: RuntimeSummary;
}): DaemonHeartbeat {
  return {
    pid: process.pid,
    status: args.status,
    execute: args.execute,
    commitState: args.commitState,
    intervalMs: args.intervalMs,
    tickCount: args.tickCount,
    startedAt: args.startedAt,
    updatedAt: nowIso(),
    lastTickStartedAt: args.lastTickStartedAt ?? "",
    lastTickFinishedAt: args.lastTickFinishedAt ?? "",
    lastSuccessfulTickAt: args.lastSuccessfulTickAt ?? "",
    lastTickMode: args.lastTickMode ?? "",
    lastError: args.lastError ?? "",
    nextWakeAt: args.nextWakeAt ?? "",
    runtimePaused: args.runtimeSummary?.paused ?? false,
    runtimePauseCode: args.runtimeSummary?.pauseCode ?? "",
    runtimePauseReason: args.runtimeSummary?.pauseReason ?? "",
    runtimeLastAction: args.runtimeSummary?.lastAction ?? "",
    runtimeCurrentStep: args.runtimeSummary?.currentStep ?? null,
    stateFile: args.stateFile,
    eventsLogFile: args.eventsLogFile,
  };
}

function readRuntimeSummary(stateFile: string): RuntimeSummary {
  try {
    const runtimeState = loadRuntimeState(stateFile);
    return {
      paused: runtimeState.risk.paused,
      pauseCode: runtimeState.risk.pauseCode,
      pauseReason: runtimeState.risk.pauseReason,
      lastAction: runtimeState.run.lastAction,
      currentStep: runtimeState.run.currentStep,
    };
  } catch {
    return {
      paused: false,
      pauseCode: "",
      pauseReason: "",
      lastAction: "",
      currentStep: null,
    };
  }
}

function saveHeartbeat(filePath: string, heartbeat: DaemonHeartbeat): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(heartbeat, null, 2)}\n`, "utf8");
}

export async function runDaemonRunner(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }
  if (cli.configFile) {
    applyAppConfigFileToProcessEnv(cli.configFile);
  }

  const config = loadExecutorConfig();
  if (stopRequested(config.daemonStopFile)) {
    fs.rmSync(config.daemonStopFile, { force: true });
  }
  const startedAt = nowIso();
  let tickCount = 0;
  let stopped = false;
  let lastTickStartedAt = "";
  let lastTickFinishedAt = "";
  let lastSuccessfulTickAt = "";
  let lastTickMode = "";
  let lastError = "";

  const stopHandler = () => {
    stopped = true;
  };

  process.once("SIGINT", stopHandler);
  process.once("SIGTERM", stopHandler);

  try {
    fs.mkdirSync(path.dirname(config.daemonPidFile), { recursive: true });
    fs.writeFileSync(config.daemonPidFile, `${process.pid}\n`, "utf8");
    saveHeartbeat(
      config.heartbeatFile,
      buildHeartbeat({
        status: "starting",
        execute: cli.execute,
        commitState: cli.commitState,
        intervalMs: cli.intervalMs,
        tickCount,
        startedAt,
        stateFile: config.stateFile,
        eventsLogFile: config.eventsLogFile,
        runtimeSummary: readRuntimeSummary(config.stateFile),
      }),
    );

    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "DAEMON_RUNNER_STARTED",
      message: "Daemon runner started.",
      payload: {
        execute: cli.execute,
        commitState: cli.commitState,
        intervalMs: cli.intervalMs,
        maxTicks: cli.maxTicks ?? null,
        heartbeatFile: config.heartbeatFile,
      },
    });

    while (!stopped && (cli.maxTicks === undefined || tickCount < cli.maxTicks)) {
      if (stopRequested(config.daemonStopFile)) {
        stopped = true;
        break;
      }
      lastTickStartedAt = nowIso();
      saveHeartbeat(
        config.heartbeatFile,
        buildHeartbeat({
          status: "running_tick",
          execute: cli.execute,
          commitState: cli.commitState,
          intervalMs: cli.intervalMs,
          tickCount,
          startedAt,
          stateFile: config.stateFile,
          eventsLogFile: config.eventsLogFile,
          lastTickStartedAt,
          lastTickFinishedAt,
          lastSuccessfulTickAt,
          lastTickMode,
          lastError,
          runtimeSummary: readRuntimeSummary(config.stateFile),
        }),
      );

      try {
        const tickArgs = cli.execute ? ["--execute"] : [];
        if (cli.configFile) {
          tickArgs.push("--config", cli.configFile);
        }
        if (cli.commitState) {
          tickArgs.push("--commit-state");
        }
        const result = await runHourlyDaemon({
          argv: tickArgs,
          printOutput: false,
        });
        tickCount += 1;
        lastTickFinishedAt = nowIso();
        lastSuccessfulTickAt = lastTickFinishedAt;
        lastTickMode = String(result.mode ?? "unknown");
        lastError = "";

        appendExecutionEvent(config.eventsLogFile, {
          timestamp: lastTickFinishedAt,
          eventType: "DAEMON_RUNNER_TICK",
          message: "Daemon runner completed one hourly tick.",
          payload: {
            tickCount,
            mode: lastTickMode,
            execute: cli.execute,
            commitState: cli.commitState,
          },
        });

        console.log(
          JSON.stringify(
            {
              mode: "runner_tick_completed",
              tickCount,
              tickMode: lastTickMode,
              execute: cli.execute,
              commitState: cli.commitState,
              runtimePaused: readRuntimeSummary(config.stateFile).paused,
              runtimePauseCode: readRuntimeSummary(config.stateFile).pauseCode,
              heartbeatFile: config.heartbeatFile,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        tickCount += 1;
        lastTickFinishedAt = nowIso();
        lastTickMode = "error";
        lastError = error instanceof Error ? error.stack ?? error.message : String(error);

        saveHeartbeat(
          config.heartbeatFile,
          buildHeartbeat({
            status: "error",
            execute: cli.execute,
            commitState: cli.commitState,
            intervalMs: cli.intervalMs,
            tickCount,
            startedAt,
            stateFile: config.stateFile,
            eventsLogFile: config.eventsLogFile,
            lastTickStartedAt,
            lastTickFinishedAt,
            lastSuccessfulTickAt,
            lastTickMode,
            lastError,
            runtimeSummary: readRuntimeSummary(config.stateFile),
          }),
        );

        appendExecutionEvent(config.eventsLogFile, {
          timestamp: lastTickFinishedAt,
          eventType: "DAEMON_RUNNER_ERROR",
          message: "Daemon runner tick failed.",
          payload: {
            tickCount,
            error: lastError,
          },
        });

        throw error;
      }

      if (stopped || (cli.maxTicks !== undefined && tickCount >= cli.maxTicks)) {
        break;
      }

      const nextWakeAt = new Date(Date.now() + cli.intervalMs).toISOString();
      saveHeartbeat(
        config.heartbeatFile,
        buildHeartbeat({
          status: "sleeping",
          execute: cli.execute,
          commitState: cli.commitState,
          intervalMs: cli.intervalMs,
          tickCount,
          startedAt,
          stateFile: config.stateFile,
          eventsLogFile: config.eventsLogFile,
          lastTickStartedAt,
          lastTickFinishedAt,
          lastSuccessfulTickAt,
          lastTickMode,
          lastError,
          nextWakeAt,
          runtimeSummary: readRuntimeSummary(config.stateFile),
        }),
      );
      stopped = await sleepUntilNextTick(cli.intervalMs, config.daemonStopFile);
    }
  } finally {
    fs.rmSync(config.daemonPidFile, { force: true });
    if (stopRequested(config.daemonStopFile)) {
      fs.rmSync(config.daemonStopFile, { force: true });
    }
    saveHeartbeat(
      config.heartbeatFile,
      buildHeartbeat({
        status: "stopped",
        execute: cli.execute,
        commitState: cli.commitState,
        intervalMs: cli.intervalMs,
        tickCount,
        startedAt,
        stateFile: config.stateFile,
        eventsLogFile: config.eventsLogFile,
        lastTickStartedAt,
        lastTickFinishedAt,
        lastSuccessfulTickAt,
        lastTickMode,
        lastError,
        runtimeSummary: readRuntimeSummary(config.stateFile),
      }),
    );
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "DAEMON_RUNNER_STOPPED",
      message: "Daemon runner stopped.",
      payload: {
        tickCount,
        lastTickMode,
        lastError,
        heartbeatFile: config.heartbeatFile,
      },
    });
    process.removeListener("SIGINT", stopHandler);
    process.removeListener("SIGTERM", stopHandler);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDaemonRunner().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
