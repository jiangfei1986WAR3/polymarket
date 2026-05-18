import path from "node:path";

import type { AccountMode, ExecutorConfig, SignatureType } from "./types.js";

function requireHexPrivateKey(name: string): `0x${string}` | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (!value.startsWith("0x")) {
    throw new Error(`${name} must start with 0x`);
  }
  return value as `0x${string}`;
}

function readAddress(name: string): `0x${string}` | undefined {
  const value = process.env[name]?.trim();
  return value ? (value as `0x${string}`) : undefined;
}

function readSignatureType(): SignatureType {
  const raw = Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "0");
  if (raw !== 0 && raw !== 1 && raw !== 2 && raw !== 3) {
    throw new Error(`Unsupported POLYMARKET_SIGNATURE_TYPE: ${raw}`);
  }
  return raw;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readAccountMode(): AccountMode {
  const value = process.env.POLYMARKET_ACCOUNT_MODE?.trim().toLowerCase();
  if (!value || value === "eoa" || value === "wallet") {
    return "eoa";
  }
  if (value === "poly_proxy" || value === "email_proxy") {
    return "poly_proxy";
  }
  if (value === "deposit_wallet_1271" || value === "deposit_wallet" || value === "deposit_wallet_flow") {
    return "deposit_wallet_1271";
  }
  throw new Error(`Unsupported POLYMARKET_ACCOUNT_MODE: ${value}`);
}

export function loadExecutorConfig(): ExecutorConfig {
  const baseDir = process.cwd();
  return {
    accountMode: readAccountMode(),
    host: process.env.POLYMARKET_HOST ?? "https://clob.polymarket.com",
    chainId: Number(process.env.POLYMARKET_CHAIN_ID ?? "137"),
    rpcUrl: process.env.POLYGON_RPC_URL ?? "https://1rpc.io/matic",
    dataApiBaseUrl: process.env.POLYMARKET_DATA_API_URL ?? "https://data-api.polymarket.com",
    gammaApiBaseUrl: process.env.POLYMARKET_GAMMA_API_URL ?? "https://gamma-api.polymarket.com",
    strategyDir:
      process.env.POLYMARKET_STRATEGY_DIR ?? path.join(baseDir, "..", "strategy_outputs", "2026-W20-main"),
    baseStakeU: Number(process.env.POLYMARKET_BASE_STAKE_U ?? "2"),
    binanceApiBaseUrl: process.env.BINANCE_API_BASE_URL ?? "https://api.binance.com",
    binanceSymbol: process.env.BINANCE_SYMBOL ?? "BTCUSDT",
    autoRedeemEnabled: readBooleanEnv("POLYMARKET_AUTO_REDEEM_ENABLED", true),
    relayerApiKey: process.env.POLYMARKET_RELAYER_API_KEY?.trim() || undefined,
    relayerApiKeyAddress: readAddress("POLYMARKET_RELAYER_API_KEY_ADDRESS"),
    maxDailyLossU: Number(process.env.POLYMARKET_MAX_DAILY_LOSS_U ?? "126"),
    maxConsecutiveBlowups: Number(process.env.POLYMARKET_MAX_CONSECUTIVE_BLOWUPS ?? "1"),
    maxApiFailures: Number(process.env.POLYMARKET_MAX_API_FAILURES ?? "3"),
    privateKey: requireHexPrivateKey("POLYMARKET_PRIVATE_KEY"),
    walletAddress: readAddress("POLYMARKET_WALLET_ADDRESS"),
    funderAddress: readAddress("POLYMARKET_FUNDER_ADDRESS"),
    signatureType: readSignatureType(),
    stateFile: process.env.POLYMARKET_STATE_FILE ?? path.join(baseDir, "runtime_state", "runtime_state_v2.json"),
    eventsLogFile: process.env.POLYMARKET_EVENTS_LOG ?? path.join(baseDir, "runtime_state", "execution_events.jsonl"),
    heartbeatFile:
      process.env.POLYMARKET_HEARTBEAT_FILE ?? path.join(baseDir, "runtime_state", "daemon_heartbeat.json"),
    daemonPidFile: process.env.POLYMARKET_DAEMON_PID_FILE ?? path.join(baseDir, "runtime_state", "daemon_runner.pid"),
    daemonStdoutLogFile:
      process.env.POLYMARKET_DAEMON_STDOUT_LOG ?? path.join(baseDir, "runtime_state", "daemon_runner.stdout.log"),
    daemonStderrLogFile:
      process.env.POLYMARKET_DAEMON_STDERR_LOG ?? path.join(baseDir, "runtime_state", "daemon_runner.stderr.log"),
    daemonStopFile:
      process.env.POLYMARKET_DAEMON_STOP_FILE ?? path.join(baseDir, "runtime_state", "daemon_runner.stop"),
  };
}
