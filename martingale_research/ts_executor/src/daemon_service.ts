import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { buildEnvOverridesFromAppConfig, loadAppConfig, validateAppConfig } from "./app_config.js";
import { loadExecutorConfig } from "./config.js";
import { runDaemonStatus } from "./daemon_status.js";

type ServiceAction = "start" | "stop" | "status" | "restart";

interface CliArgs {
  action: ServiceAction;
  configFile?: string;
  execute: boolean;
  executeSpecified: boolean;
  intervalMs: number;
  intervalSpecified: boolean;
  commitState: boolean;
  commitStateSpecified: boolean;
  staleAfterMs: number;
  stopWaitMs: number;
  startWaitMs: number;
  help: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    action: "status",
    configFile: undefined,
    execute: false,
    executeSpecified: false,
    intervalMs: 60_000,
    intervalSpecified: false,
    commitState: true,
    commitStateSpecified: false,
    staleAfterMs: 180_000,
    stopWaitMs: 15_000,
    startWaitMs: 10_000,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "start":
      case "stop":
      case "status":
      case "restart":
        out.action = arg;
        break;
      case "--config":
        out.configFile = path.resolve(next);
        i += 1;
        break;
      case "--execute":
        out.execute = true;
        out.executeSpecified = true;
        break;
      case "--interval-ms":
        out.intervalMs = Math.max(1_000, Number(next));
        out.intervalSpecified = true;
        i += 1;
        break;
      case "--no-commit-state":
        out.commitState = false;
        out.commitStateSpecified = true;
        break;
      case "--stale-after-ms":
        out.staleAfterMs = Math.max(1_000, Number(next));
        i += 1;
        break;
      case "--stop-wait-ms":
        out.stopWaitMs = Math.max(1_000, Number(next));
        i += 1;
        break;
      case "--start-wait-ms":
        out.startWaitMs = Math.max(1_000, Number(next));
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
  console.log("  npm run daemon-service -- status");
  console.log("  npm run daemon-service -- start --interval-ms 60000");
  console.log("  npm run daemon-service -- start --execute");
  console.log("  npm run daemon-service -- stop");
  console.log("  npm run daemon-service -- restart --interval-ms 60000");
  console.log("");
  console.log("Notes:");
  console.log("  - Use --config <app_config.json> to load EXE-style config.");
  console.log("  - start launches daemon_runner in detached background mode.");
  console.log("  - stop requests graceful shutdown via stop file, then force-kills if needed.");
  console.log("  - status delegates to daemon-status.");
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readPidFile(pidFile: string): number | null {
  if (!fs.existsSync(pidFile)) {
    return null;
  }
  const raw = fs.readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function writePidFile(pidFile: string, pid: number): void {
  ensureParentDir(pidFile);
  fs.writeFileSync(pidFile, `${pid}\n`, "utf8");
}

function removeFileIfExists(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readHeartbeatPid(heartbeatFile: string): number | null {
  if (!fs.existsSync(heartbeatFile)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(heartbeatFile, "utf8")) as { pid?: number };
    return typeof raw.pid === "number" && raw.pid > 0 ? raw.pid : null;
  } catch {
    return null;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(250);
  }
  return !isProcessAlive(pid);
}

async function waitForRunnerPid(config: ReturnType<typeof loadExecutorConfig>, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let lastHeartbeatPid: number | null = null;
  let stableHeartbeatCount = 0;
  while (Date.now() < deadline) {
    const pidFromHeartbeat = readHeartbeatPid(config.heartbeatFile);
    if (pidFromHeartbeat !== null && pidFromHeartbeat === lastHeartbeatPid) {
      stableHeartbeatCount += 1;
    } else {
      stableHeartbeatCount = 1;
      lastHeartbeatPid = pidFromHeartbeat;
    }
    const pidFromFile = readPidFile(config.daemonPidFile);
    if (
      pidFromHeartbeat !== null &&
      pidFromFile !== null &&
      pidFromHeartbeat === pidFromFile &&
      isProcessAlive(pidFromHeartbeat)
    ) {
      return pidFromHeartbeat;
    }
    if (isProcessAlive(pidFromHeartbeat)) {
      if (stableHeartbeatCount >= 2) {
        return pidFromHeartbeat;
      }
    } else if (isProcessAlive(pidFromFile)) {
      return pidFromFile;
    }
    await sleep(250);
  }
  return null;
}

function applyAppConfigToServiceArgs(cli: CliArgs): void {
  if (!cli.configFile) {
    return;
  }

  const config = loadAppConfig(cli.configFile);
  const issues = validateAppConfig(config);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid app config: ${details}`);
  }

  const envOverrides = buildEnvOverridesFromAppConfig(config);
  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = value;
  }

  if (!cli.executeSpecified) {
    cli.execute = config.trading.executeLive;
  }
  if (!cli.commitStateSpecified) {
    cli.commitState = config.trading.commitState;
  }
  if (!cli.intervalSpecified) {
    cli.intervalMs = config.trading.intervalMs;
  }
}

async function startService(cli: CliArgs): Promise<void> {
  const config = loadExecutorConfig();
  const existingPid = readPidFile(config.daemonPidFile);
  if (isProcessAlive(existingPid)) {
    console.log(
      JSON.stringify(
        {
          mode: "daemon_service_start_skipped",
          reason: "already_running",
          pid: existingPid,
          pidFile: config.daemonPidFile,
          heartbeatFile: config.heartbeatFile,
        },
        null,
        2,
      ),
    );
    return;
  }

  removeFileIfExists(config.daemonPidFile);
  removeFileIfExists(config.daemonStopFile);
  ensureParentDir(config.daemonStdoutLogFile);
  ensureParentDir(config.daemonStderrLogFile);

  const require = createRequire(import.meta.url);
  const tsxCliPath = require.resolve("tsx/cli");
  const daemonRunnerPath = path.resolve(process.cwd(), "src", "daemon_runner.ts");
  const runnerArgs = [tsxCliPath, daemonRunnerPath];

  if (cli.execute) {
    runnerArgs.push("--execute");
  }
  if (!cli.commitState) {
    runnerArgs.push("--no-commit-state");
  }
  runnerArgs.push("--interval-ms", String(cli.intervalMs));

  const stdoutFd = fs.openSync(config.daemonStdoutLogFile, "a");
  const stderrFd = fs.openSync(config.daemonStderrLogFile, "a");

  const child = spawn(process.execPath, runnerArgs, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: process.env,
    windowsHide: true,
  });
  if (!child.pid) {
    throw new Error("Failed to start daemon runner: child pid is undefined");
  }
  child.unref();
  writePidFile(config.daemonPidFile, child.pid);
  const resolvedPid = (await waitForRunnerPid(config, cli.startWaitMs)) ?? child.pid;
  writePidFile(config.daemonPidFile, resolvedPid);

  console.log(
    JSON.stringify(
      {
        mode: "daemon_service_started",
        pid: resolvedPid,
        execute: cli.execute,
        commitState: cli.commitState,
        intervalMs: cli.intervalMs,
        startWaitMs: cli.startWaitMs,
        pidFile: config.daemonPidFile,
        stopFile: config.daemonStopFile,
        stdoutLogFile: config.daemonStdoutLogFile,
        stderrLogFile: config.daemonStderrLogFile,
      },
      null,
      2,
    ),
  );
}

async function stopService(cli: CliArgs): Promise<void> {
  const config = loadExecutorConfig();
  const pidFromFile = readPidFile(config.daemonPidFile);
  const pidFromHeartbeat = readHeartbeatPid(config.heartbeatFile);
  const pid = isProcessAlive(pidFromFile) ? pidFromFile : pidFromHeartbeat;
  if (!isProcessAlive(pid)) {
    removeFileIfExists(config.daemonPidFile);
    removeFileIfExists(config.daemonStopFile);
    console.log(
      JSON.stringify(
        {
          mode: "daemon_service_stop_skipped",
          reason: "not_running",
          pidFile: config.daemonPidFile,
        },
        null,
        2,
      ),
    );
    return;
  }

  ensureParentDir(config.daemonStopFile);
  fs.writeFileSync(config.daemonStopFile, `${new Date().toISOString()}\n`, "utf8");
  const stoppedGracefully = await waitForProcessExit(pid!, cli.stopWaitMs);

  if (!stoppedGracefully) {
    process.kill(pid!);
    await waitForProcessExit(pid!, 3_000);
  }

  const stillAlive = isProcessAlive(pid!);
  if (!stillAlive) {
    removeFileIfExists(config.daemonPidFile);
    removeFileIfExists(config.daemonStopFile);
  }

  console.log(
    JSON.stringify(
      {
        mode: "daemon_service_stopped",
        pid,
        graceful: stoppedGracefully,
        stopWaitMs: cli.stopWaitMs,
        stillAlive,
        pidFile: config.daemonPidFile,
        stopFile: config.daemonStopFile,
      },
      null,
      2,
    ),
  );
}

export async function runDaemonService(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }

  applyAppConfigToServiceArgs(cli);

  if (cli.action === "status") {
    await runDaemonStatus(["--stale-after-ms", String(cli.staleAfterMs)]);
    return;
  }

  if (cli.action === "start") {
    await startService(cli);
    return;
  }

  if (cli.action === "stop") {
    await stopService(cli);
    return;
  }

  await stopService(cli);
  await sleep(500);
  await startService(cli);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDaemonService().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
