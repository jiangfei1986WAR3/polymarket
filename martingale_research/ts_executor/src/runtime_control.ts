import { pathToFileURL } from "node:url";

import { buildEnvOverridesFromAppConfig, loadAppConfig, validateAppConfig } from "./app_config.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { pauseRuntimeState, resumeRuntimeState } from "./pause_controller.js";
import { loadRuntimeState, saveRuntimeState } from "./state.js";

type ControlAction = "status" | "pause" | "resume";

interface CliArgs {
  action: ControlAction;
  configFile?: string;
  code?: string;
  reason?: string;
  help: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    action: "status",
    configFile: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "status":
      case "pause":
      case "resume":
        out.action = arg;
        break;
      case "--config":
        out.configFile = next;
        i += 1;
        break;
      case "--code":
        out.code = next;
        i += 1;
        break;
      case "--reason":
        out.reason = next;
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
  console.log("  npm run runtime-control -- status");
  console.log("  npm run runtime-control -- status --config .\\app_config.json");
  console.log('  npm run runtime-control -- pause --code MANUAL_PAUSE --reason "Paused by operator"');
  console.log('  npm run runtime-control -- resume --reason "Resume after review"');
}

function applyAppConfigToRuntime(cli: CliArgs): void {
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
}

function summarizeState(stateFile: string, eventsLogFile: string) {
  const state = loadRuntimeState(stateFile);
  return {
    mode: "runtime_status",
    stateFile,
    eventsLogFile,
    paused: state.risk.paused,
    pauseCode: state.risk.pauseCode,
    pauseReason: state.risk.pauseReason,
    lastGuardDecision: state.risk.lastGuardDecision,
    currentStep: state.run.currentStep,
    inRun: state.run.inRun,
    lastAction: state.run.lastAction,
    lastReason: state.run.lastReason,
    lastDirection: state.run.lastDirection,
    lastOrderId: state.orders.lastOrderId,
    lastOrderStatus: state.orders.lastOrderStatus,
    totalRunsStarted: state.run.totalRunsStarted,
    totalWins: state.run.totalWins,
    totalLosses: state.run.totalLosses,
    totalBlowups: state.run.totalBlowups,
    consecutiveBlowups: state.risk.consecutiveBlowups,
    consecutiveApiFailures: state.risk.consecutiveApiFailures,
    dailyLossU: state.risk.dailyLossU,
    updatedAt: nowIso(),
  };
}

export async function runRuntimeControl(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }

  applyAppConfigToRuntime(cli);

  const config = loadExecutorConfig();
  const state = loadRuntimeState(config.stateFile);

  if (cli.action === "status") {
    console.log(JSON.stringify(summarizeState(config.stateFile, config.eventsLogFile), null, 2));
    return;
  }

  if (cli.action === "pause") {
    const pauseCode = cli.code?.trim() || "MANUAL_PAUSE";
    const pauseReason = cli.reason?.trim() || "Paused manually by operator.";
    const nextState = pauseRuntimeState(state, pauseCode, pauseReason, "MANUAL_PAUSE");
    saveRuntimeState(config.stateFile, nextState);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "RUNTIME_MANUALLY_PAUSED",
      message: pauseReason,
      payload: {
        pauseCode,
        pauseReason,
      },
    });
    console.log(JSON.stringify(summarizeState(config.stateFile, config.eventsLogFile), null, 2));
    return;
  }

  const resumeReason = cli.reason?.trim() || "Resumed manually by operator.";
  const nextState = resumeRuntimeState(state, resumeReason, "MANUAL_RESUME");
  saveRuntimeState(config.stateFile, nextState);
  appendExecutionEvent(config.eventsLogFile, {
    timestamp: nowIso(),
    eventType: "RUNTIME_MANUALLY_RESUMED",
    message: resumeReason,
    payload: {
      reason: resumeReason,
    },
  });
  console.log(JSON.stringify(summarizeState(config.stateFile, config.eventsLogFile), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeControl().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
