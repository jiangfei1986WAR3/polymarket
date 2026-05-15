import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAppUiState } from "./app_ui_state.js";

interface CliArgs {
  configFile: string;
  staleAfterMs: number;
  logLimit: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    configFile: path.join(process.cwd(), "app_config.json"),
    staleAfterMs: 180_000,
    logLimit: 20,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--config":
      case "--file":
        out.configFile = path.resolve(next);
        i += 1;
        break;
      case "--stale-after-ms":
        out.staleAfterMs = Math.max(1_000, Number(next));
        i += 1;
        break;
      case "--log-limit":
        out.logLimit = Math.max(1, Number(next));
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
  console.log("  npm run app-ui --");
  console.log("  npm run app-ui -- --config .\\app_config.json");
  console.log("");
  console.log("Options:");
  console.log("  --config <path>        config file path, default: ./app_config.json");
  console.log("  --stale-after-ms <n>   heartbeat stale threshold");
  console.log("  --log-limit <n>        number of recent log entries");
}

export async function runAppUiStateCli(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }

  const state = buildAppUiState({
    configFile: cli.configFile,
    staleAfterMs: cli.staleAfterMs,
    logLimit: cli.logLimit,
  });
  console.log(JSON.stringify(state, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAppUiStateCli().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
