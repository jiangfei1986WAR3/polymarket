import fs from "node:fs";
import path from "node:path";

import type { AppConfigValidationIssue, ExecutorAppConfig, ExecutorConfig, SignatureType } from "./types.js";

function maskSecret(value: string, keepStart = 6, keepEnd = 4): string {
  if (!value) {
    return "";
  }
  if (value.length <= keepStart + keepEnd) {
    return "*".repeat(Math.max(4, value.length));
  }
  return `${value.slice(0, keepStart)}***${value.slice(-keepEnd)}`;
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHexPrivateKey(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

export function makeDefaultAppConfig(baseDir = process.cwd()): ExecutorAppConfig {
  const runtimeDir = path.join(baseDir, "runtime_state");
  return {
    version: 1,
    profileName: "default-windows-profile",
    credentials: {
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
      walletAddress: "0x1111111111111111111111111111111111111111",
      funderAddress: "0x2222222222222222222222222222222222222222",
      signatureType: 3,
    },
    network: {
      host: "https://clob.polymarket.com",
      chainId: 137,
      rpcUrl: "https://1rpc.io/matic",
      dataApiBaseUrl: "https://data-api.polymarket.com",
      gammaApiBaseUrl: "https://gamma-api.polymarket.com",
      binanceApiBaseUrl: "https://api.binance.com",
      binanceSymbol: "BTCUSDT",
    },
    trading: {
      executeLive: false,
      commitState: true,
      intervalMs: 60_000,
      strategyDir: path.join(baseDir, "..", "strategy_outputs", "2026-W20-main"),
      baseStakeU: 2,
    },
    redemption: {
      autoRedeemEnabled: true,
      relayerApiKey: "",
      relayerApiKeyAddress: "",
    },
    riskLimits: {
      maxDailyLossU: 126,
      maxConsecutiveBlowups: 1,
      maxApiFailures: 3,
    },
    paths: {
      stateFile: path.join(runtimeDir, "runtime_state_v2.json"),
      eventsLogFile: path.join(runtimeDir, "execution_events.jsonl"),
      heartbeatFile: path.join(runtimeDir, "daemon_heartbeat.json"),
      daemonPidFile: path.join(runtimeDir, "daemon_runner.pid"),
      daemonStdoutLogFile: path.join(runtimeDir, "daemon_runner.stdout.log"),
      daemonStderrLogFile: path.join(runtimeDir, "daemon_runner.stderr.log"),
      daemonStopFile: path.join(runtimeDir, "daemon_runner.stop"),
    },
    windows: {
      scheduledTaskName: "PolymarketTsExecutorDaemon",
      autoStartOnLogon: true,
      autoStartOnBoot: false,
    },
  };
}

export function loadAppConfig(filePath: string): ExecutorAppConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ExecutorAppConfig> & {
    redemption?: Partial<ExecutorAppConfig["redemption"]> & {
      builderApiKey?: string;
      builderApiSecret?: string;
      builderApiPassphrase?: string;
    };
  };
  const base = makeDefaultAppConfig(path.dirname(filePath));
  const legacyRelayerApiKey =
    parsed.redemption?.relayerApiKey ??
    parsed.redemption?.builderApiKey ??
    "";
  const legacyRelayerApiKeyAddress = parsed.redemption?.relayerApiKeyAddress ?? "";
  return {
    ...base,
    ...parsed,
    credentials: {
      ...base.credentials,
      ...(parsed.credentials ?? {}),
    },
    network: {
      ...base.network,
      ...(parsed.network ?? {}),
    },
    trading: {
      ...base.trading,
      ...(parsed.trading ?? {}),
    },
    redemption: {
      ...base.redemption,
      ...(parsed.redemption ?? {}),
      relayerApiKey: legacyRelayerApiKey,
      relayerApiKeyAddress: legacyRelayerApiKeyAddress,
    },
    riskLimits: {
      ...base.riskLimits,
      ...(parsed.riskLimits ?? {}),
    },
    paths: {
      ...base.paths,
      ...(parsed.paths ?? {}),
    },
    windows: {
      ...base.windows,
      ...(parsed.windows ?? {}),
    },
  };
}

export function saveAppConfig(filePath: string, config: ExecutorAppConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function validateAppConfig(config: ExecutorAppConfig): AppConfigValidationIssue[] {
  const issues: AppConfigValidationIssue[] = [];
  const push = (pathName: string, message: string) => issues.push({ path: pathName, message });
  const expectNonEmpty = (pathName: string, value: string) => {
    if (!value.trim()) {
      push(pathName, "must not be empty");
    }
  };
  const expectPositiveNumber = (pathName: string, value: number, min = 0) => {
    if (!Number.isFinite(value) || value < min) {
      push(pathName, `must be a number >= ${min}`);
    }
  };

  if (config.version !== 1) {
    push("version", "must equal 1");
  }
  expectNonEmpty("profileName", config.profileName);

  if (!isHexPrivateKey(config.credentials.privateKey)) {
    push("credentials.privateKey", "must be a 0x-prefixed 32-byte hex private key");
  }
  if (!isHexAddress(config.credentials.walletAddress)) {
    push("credentials.walletAddress", "must be a 0x-prefixed 20-byte hex address");
  }
  if (!isHexAddress(config.credentials.funderAddress)) {
    push("credentials.funderAddress", "must be a 0x-prefixed 20-byte hex address");
  }
  if (![0, 1, 2, 3].includes(config.credentials.signatureType)) {
    push("credentials.signatureType", "must be one of 0, 1, 2, 3");
  }

  if (!isHttpUrl(config.network.host)) {
    push("network.host", "must be an http/https URL");
  }
  expectPositiveNumber("network.chainId", config.network.chainId, 1);
  if (!isHttpUrl(config.network.rpcUrl)) {
    push("network.rpcUrl", "must be an http/https URL");
  }
  if (!isHttpUrl(config.network.dataApiBaseUrl)) {
    push("network.dataApiBaseUrl", "must be an http/https URL");
  }
  if (!isHttpUrl(config.network.gammaApiBaseUrl)) {
    push("network.gammaApiBaseUrl", "must be an http/https URL");
  }
  if (!isHttpUrl(config.network.binanceApiBaseUrl)) {
    push("network.binanceApiBaseUrl", "must be an http/https URL");
  }
  expectNonEmpty("network.binanceSymbol", config.network.binanceSymbol);

  expectPositiveNumber("trading.intervalMs", config.trading.intervalMs, 1_000);
  expectNonEmpty("trading.strategyDir", config.trading.strategyDir);
  expectPositiveNumber("trading.baseStakeU", config.trading.baseStakeU ?? 2, 2);
  if ((config.trading.baseStakeU ?? 2) > 200) {
    push("trading.baseStakeU", "must be a number <= 200");
  }
  if (config.redemption.autoRedeemEnabled) {
    expectNonEmpty("redemption.relayerApiKey", config.redemption.relayerApiKey);
    if (!isHexAddress(config.redemption.relayerApiKeyAddress)) {
      push("redemption.relayerApiKeyAddress", "must be a 0x-prefixed 20-byte hex address");
    }
  }

  expectPositiveNumber("riskLimits.maxDailyLossU", config.riskLimits.maxDailyLossU, 0);
  expectPositiveNumber("riskLimits.maxConsecutiveBlowups", config.riskLimits.maxConsecutiveBlowups, 0);
  expectPositiveNumber("riskLimits.maxApiFailures", config.riskLimits.maxApiFailures, 0);

  for (const [key, value] of Object.entries(config.paths)) {
    expectNonEmpty(`paths.${key}`, value);
  }

  expectNonEmpty("windows.scheduledTaskName", config.windows.scheduledTaskName);

  return issues;
}

export function summarizeAppConfig(config: ExecutorAppConfig) {
  return {
    version: config.version,
    profileName: config.profileName,
    credentials: {
      privateKeyMasked: maskSecret(config.credentials.privateKey, 8, 6),
      walletAddress: config.credentials.walletAddress,
      funderAddress: config.credentials.funderAddress,
      signatureType: config.credentials.signatureType,
    },
    network: config.network,
    trading: config.trading,
    redemption: {
      autoRedeemEnabled: config.redemption.autoRedeemEnabled,
      relayerApiKeyMasked: maskSecret(config.redemption.relayerApiKey, 6, 4),
      relayerApiKeyAddress: config.redemption.relayerApiKeyAddress,
    },
    riskLimits: config.riskLimits,
    paths: config.paths,
    windows: config.windows,
  };
}

export function buildEnvOverridesFromAppConfig(config: ExecutorAppConfig): Record<string, string> {
  return {
    POLYMARKET_HOST: config.network.host,
    POLYMARKET_CHAIN_ID: String(config.network.chainId),
    POLYGON_RPC_URL: config.network.rpcUrl,
    POLYMARKET_DATA_API_URL: config.network.dataApiBaseUrl,
    POLYMARKET_GAMMA_API_URL: config.network.gammaApiBaseUrl,
    BINANCE_API_BASE_URL: config.network.binanceApiBaseUrl,
    BINANCE_SYMBOL: config.network.binanceSymbol,
    POLYMARKET_AUTO_REDEEM_ENABLED: String(Boolean(config.redemption.autoRedeemEnabled)),
    POLYMARKET_RELAYER_API_KEY: config.redemption.relayerApiKey,
    POLYMARKET_RELAYER_API_KEY_ADDRESS: config.redemption.relayerApiKeyAddress,
    POLYMARKET_MAX_DAILY_LOSS_U: String(config.riskLimits.maxDailyLossU),
    POLYMARKET_MAX_CONSECUTIVE_BLOWUPS: String(config.riskLimits.maxConsecutiveBlowups),
    POLYMARKET_MAX_API_FAILURES: String(config.riskLimits.maxApiFailures),
    POLYMARKET_PRIVATE_KEY: config.credentials.privateKey,
    POLYMARKET_WALLET_ADDRESS: config.credentials.walletAddress,
    POLYMARKET_FUNDER_ADDRESS: config.credentials.funderAddress,
    POLYMARKET_SIGNATURE_TYPE: String(config.credentials.signatureType as SignatureType),
    POLYMARKET_STRATEGY_DIR: config.trading.strategyDir,
    POLYMARKET_BASE_STAKE_U: String(config.trading.baseStakeU ?? 2),
    POLYMARKET_STATE_FILE: config.paths.stateFile,
    POLYMARKET_EVENTS_LOG: config.paths.eventsLogFile,
    POLYMARKET_HEARTBEAT_FILE: config.paths.heartbeatFile,
    POLYMARKET_DAEMON_PID_FILE: config.paths.daemonPidFile,
    POLYMARKET_DAEMON_STDOUT_LOG: config.paths.daemonStdoutLogFile,
    POLYMARKET_DAEMON_STDERR_LOG: config.paths.daemonStderrLogFile,
    POLYMARKET_DAEMON_STOP_FILE: config.paths.daemonStopFile,
  };
}

export function buildExecutorConfigFromAppConfig(config: ExecutorAppConfig): ExecutorConfig {
  return {
    host: config.network.host,
    chainId: config.network.chainId,
    rpcUrl: config.network.rpcUrl,
    dataApiBaseUrl: config.network.dataApiBaseUrl,
    gammaApiBaseUrl: config.network.gammaApiBaseUrl,
    strategyDir: config.trading.strategyDir,
    baseStakeU: config.trading.baseStakeU ?? 2,
    binanceApiBaseUrl: config.network.binanceApiBaseUrl,
    binanceSymbol: config.network.binanceSymbol,
    autoRedeemEnabled: config.redemption.autoRedeemEnabled,
    relayerApiKey: config.redemption.relayerApiKey || undefined,
    relayerApiKeyAddress: (config.redemption.relayerApiKeyAddress || undefined) as `0x${string}` | undefined,
    maxDailyLossU: config.riskLimits.maxDailyLossU,
    maxConsecutiveBlowups: config.riskLimits.maxConsecutiveBlowups,
    maxApiFailures: config.riskLimits.maxApiFailures,
    privateKey: config.credentials.privateKey as `0x${string}`,
    walletAddress: config.credentials.walletAddress as `0x${string}`,
    funderAddress: config.credentials.funderAddress as `0x${string}`,
    signatureType: config.credentials.signatureType,
    stateFile: config.paths.stateFile,
    eventsLogFile: config.paths.eventsLogFile,
    heartbeatFile: config.paths.heartbeatFile,
    daemonPidFile: config.paths.daemonPidFile,
    daemonStdoutLogFile: config.paths.daemonStdoutLogFile,
    daemonStderrLogFile: config.paths.daemonStderrLogFile,
    daemonStopFile: config.paths.daemonStopFile,
  };
}
