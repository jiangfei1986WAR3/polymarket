import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildEnvOverridesFromAppConfig,
  loadAppConfig,
  makeDefaultAppConfig,
  saveAppConfig,
  summarizeAppConfig,
  validateAppConfig,
} from "./app_config.js";

type Command = "init" | "validate" | "summary" | "env";

interface CliArgs {
  command: Command;
  filePath: string;
  force: boolean;
  includeSecrets: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    command: "summary",
    filePath: path.join(process.cwd(), "app_config.json"),
    force: false,
    includeSecrets: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "init":
      case "validate":
      case "summary":
      case "env":
        out.command = arg;
        break;
      case "--file":
        out.filePath = path.resolve(next);
        i += 1;
        break;
      case "--force":
        out.force = true;
        break;
      case "--include-secrets":
        out.includeSecrets = true;
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
  console.log("  npm run app-config -- init");
  console.log("  npm run app-config -- validate");
  console.log("  npm run app-config -- summary");
  console.log("  npm run app-config -- env");
  console.log("");
  console.log("Options:");
  console.log("  --file <path>          config file path, default: ./app_config.json");
  console.log("  --force                overwrite when used with init");
  console.log("  --include-secrets      include raw secret values in env output");
}

function maskEnv(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  if (out.POLYMARKET_PRIVATE_KEY) {
    out.POLYMARKET_PRIVATE_KEY = `${out.POLYMARKET_PRIVATE_KEY.slice(0, 8)}***${out.POLYMARKET_PRIVATE_KEY.slice(-6)}`;
  }
  return out;
}

export async function runAppConfigCli(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }

  if (cli.command === "init") {
    const config = makeDefaultAppConfig(process.cwd());
    if (fs.existsSync(cli.filePath) && !cli.force) {
      throw new Error(`Config already exists: ${cli.filePath}. Use --force to overwrite.`);
    }
    saveAppConfig(cli.filePath, config);
    console.log(
      JSON.stringify(
        {
          mode: "app_config_initialized",
          filePath: cli.filePath,
          summary: summarizeAppConfig(config),
        },
        null,
        2,
      ),
    );
    return;
  }

  const config = loadAppConfig(cli.filePath);
  if (cli.command === "summary") {
    console.log(
      JSON.stringify(
        {
          mode: "app_config_summary",
          filePath: cli.filePath,
          summary: summarizeAppConfig(config),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cli.command === "validate") {
    const issues = validateAppConfig(config);
    console.log(
      JSON.stringify(
        {
          mode: "app_config_validation",
          filePath: cli.filePath,
          valid: issues.length === 0,
          issueCount: issues.length,
          issues,
        },
        null,
        2,
      ),
    );
    return;
  }

  const env = buildEnvOverridesFromAppConfig(config);
  console.log(
    JSON.stringify(
      {
        mode: "app_config_env",
        filePath: cli.filePath,
        env: cli.includeSecrets ? env : maskEnv(env),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAppConfigCli().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
