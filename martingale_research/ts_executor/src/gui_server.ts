import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Side } from "@polymarket/clob-client-v2";
import { getCollateralSnapshot, syncCollateralAllowance } from "./account.js";
import { buildAppUiState } from "./app_ui_state.js";
import { buildExecutorConfigFromAppConfig, loadAppConfig, makeDefaultAppConfig, saveAppConfig, validateAppConfig } from "./app_config.js";
import { resolveAccountContext, resolveSessionContext } from "./auth.js";
import { createTradingClient } from "./client.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { cancelOrder, getOrderSnapshot, postLimitOrder } from "./orders.js";
import { getPositionsSnapshot } from "./positions.js";
import {
  applyAccountSnapshot,
  applyOrderSnapshot,
  applyPositionSnapshot,
  applySessionSnapshot,
  applyTradeSnapshot,
  loadRuntimeState,
  saveRuntimeState,
} from "./state.js";
import { listStrategyCatalog } from "./strategy_loader.js";
import { getTradesForOrder } from "./trades.js";
import type { ExecutorAppConfig } from "./types.js";

interface CliArgs {
  configFile: string;
  host: string;
  port: number;
  staleAfterMs: number;
  logLimit: number;
  help: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface GuiPathEntry {
  key: string;
  label: string;
  path: string;
  exists: boolean;
}

interface StrategyRescanProgress {
  jobId: string;
  scope: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string;
  total: number;
  completed: number;
  currentKey: string;
  currentVersion: string;
  stage: string;
  detail: string;
  progressPercent: number;
  results: Array<Record<string, unknown>>;
  error: string;
}

const strategyRescanJobs = new Map<string, StrategyRescanProgress>();
const MAX_LIVE_TEST_NOTIONAL = 5;
const POSITION_REFRESH_DELAY_MS = 1200;
const POSITION_REFRESH_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getFreshPositionSnapshot(
  executorConfig: ReturnType<typeof buildExecutorConfigFromAppConfig>,
  session: Awaited<ReturnType<typeof resolveSessionContext>>,
  tokenId: string,
  expectFreshFill: boolean,
) {
  let snapshot = await getPositionsSnapshot(executorConfig, session, tokenId);
  if (!expectFreshFill || snapshot.size > 0) {
    return snapshot;
  }

  for (let attempt = 1; attempt < POSITION_REFRESH_ATTEMPTS; attempt += 1) {
    await sleep(POSITION_REFRESH_DELAY_MS);
    snapshot = await getPositionsSnapshot(executorConfig, session, tokenId);
    if (snapshot.size > 0) {
      return snapshot;
    }
  }

  return snapshot;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    configFile: path.join(process.cwd(), "app_config.json"),
    host: "127.0.0.1",
    port: 4173,
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
      case "--host":
        out.host = next;
        i += 1;
        break;
      case "--port":
        out.port = Math.max(0, Number(next));
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
  console.log("  npm run app-gui --");
  console.log("  npm run app-gui -- --config .\\app_config.json --port 4173");
}

function getUiRoot(): string {
  return path.resolve(process.cwd(), "ui");
}

function readJsonBody(req: http.IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as JsonObject);
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res: http.ServerResponse, statusCode: number, contentType: string, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function serveStatic(reqPath: string, res: http.ServerResponse): void {
  const uiRoot = getUiRoot();
  const relativePath = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const filePath = path.resolve(uiRoot, relativePath);
  if (!filePath.startsWith(uiRoot)) {
    sendText(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "text/plain; charset=utf-8", "Not Found");
    return;
  }
  sendText(res, 200, getContentType(filePath), fs.readFileSync(filePath, "utf8"));
}

async function runTsxJson(scriptName: string, args: string[]): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const tsxCliPath = require.resolve("tsx/cli");
  const scriptPath = path.resolve(process.cwd(), "src", scriptName);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse JSON output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function runProcess(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildPythonUtf8Env(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

async function runProcessJsonProgress(
  command: string,
  args: string[],
  cwd: string,
  onJsonLine: (payload: Record<string, unknown>) => void,
  env?: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdoutBuffer = "";
    let finalSummary: Record<string, unknown> | null = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const consumeStdout = (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        try {
          const payload = JSON.parse(line) as Record<string, unknown>;
          onJsonLine(payload);
          if (payload.type === "result" && payload.summary && typeof payload.summary === "object") {
            finalSummary = payload.summary as Record<string, unknown>;
          }
        } catch {
          // Ignore non-JSON log lines from helper scripts.
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      consumeStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        consumeStdout("\n");
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
        return;
      }
      if (!finalSummary) {
        reject(new Error("全量策略扫描没有返回最终摘要。"));
        return;
      }
      resolve(finalSummary);
    });
  });
}

function loadEditableConfig(configFile: string): { exists: boolean; config: ExecutorAppConfig } {
  if (fs.existsSync(configFile)) {
    return {
      exists: true,
      config: loadAppConfig(configFile),
    };
  }
  const baseDir = path.dirname(configFile);
  return {
    exists: false,
    config: makeDefaultAppConfig(baseDir),
  };
}

function ensureEditableConfigFile(configFile: string): void {
  if (fs.existsSync(configFile)) {
    return;
  }
  const baseDir = path.dirname(configFile);
  saveAppConfig(configFile, makeDefaultAppConfig(baseDir));
}

function buildGuiPathEntries(cli: CliArgs): GuiPathEntry[] {
  const editable = loadEditableConfig(cli.configFile);
  const issues = editable.exists ? validateAppConfig(editable.config) : [];
  const executorConfig =
    editable.exists && issues.length === 0 ? buildExecutorConfigFromAppConfig(editable.config) : loadExecutorConfig();

  const entries: GuiPathEntry[] = [
    {
      key: "config_dir",
      label: "配置目录",
      path: path.dirname(cli.configFile),
      exists: fs.existsSync(path.dirname(cli.configFile)),
    },
    {
      key: "logs_dir",
      label: "日志目录",
      path: path.dirname(executorConfig.eventsLogFile),
      exists: fs.existsSync(path.dirname(executorConfig.eventsLogFile)),
    },
    {
      key: "strategy_dir",
      label: "策略目录",
      path: executorConfig.strategyDir,
      exists: fs.existsSync(executorConfig.strategyDir),
    },
  ];

  return entries;
}

function summarizeValidationMarket(raw: Awaited<ReturnType<typeof locateCurrentBtc1hMarket>>) {
  if (!raw) {
    return null;
  }
  return {
    marketId: raw.marketId,
    slug: raw.slug,
    question: raw.question,
    eventTitle: raw.eventTitle,
    eventStartTime: raw.eventStartTime,
    endDate: raw.endDate,
    active: raw.active,
    closed: raw.closed,
    acceptingOrders: raw.acceptingOrders,
    negRisk: raw.negRisk,
    outcomes: raw.outcomes,
  };
}

function computePreviewOrderSize(targetNotional: number, price: number): number {
  if (!(price > 0)) {
    throw new Error(`Order price must be positive, got ${price}`);
  }
  return Number((targetNotional / price).toFixed(6));
}

function isOpenOrderStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "live" || normalized === "open";
}

async function runReadonlyAccountValidation(config: ExecutorAppConfig) {
  const issues = validateAppConfig(config);
  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  const executorConfig = buildExecutorConfigFromAppConfig(config);
  const resolvedAccount = await resolveAccountContext(executorConfig);
  const session = await resolveSessionContext(executorConfig);
  const client = createTradingClient(executorConfig, session);
  if (executorConfig.accountMode === "deposit_wallet_1271") {
    await syncCollateralAllowance(client).catch(() => undefined);
  }
  const accountSnapshot = await getCollateralSnapshot(client, session);
  const market = await locateCurrentBtc1hMarket(executorConfig);
  const positions = await getPositionsSnapshot(executorConfig, session).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  const suggestions =
    executorConfig.accountMode === "poly_proxy"
      ? [
          "请确认 walletAddress 填的是导出私钥对应 signer 地址。",
          "请确认 funderAddress 填的是 Polymarket 站内 proxy wallet 地址，而不是 signer 地址本身。",
          "只读验证通过后，再进入小额下单测试会更稳妥。",
        ]
      : executorConfig.accountMode === "deposit_wallet_1271"
        ? [
            "请确认 walletAddress 填的是导出私钥对应 signer 地址。",
            "funderAddress 可以留空让系统自动推导 deposit wallet；如果您手动填写，请确保它就是 deposit wallet 地址。",
            "deposit wallet 模式会先尝试同步余额，再进入只读验证和小额测试单会更稳妥。",
          ]
        : [
            "EOA 模式下通常 walletAddress 与 funderAddress 应保持一致。",
            "如果只读验证通过，说明当前老钱包模式的基础鉴权与余额读取仍然正常。",
          ];

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    accountMode: executorConfig.accountMode,
    session: {
      walletAddress: session.walletAddress,
      funderAddress: session.funderAddress,
      signatureType: session.signatureType,
      apiCredsPresent: Boolean(session.creds.key && session.creds.secret && session.creds.passphrase),
    },
    derivedDepositWallet: resolvedAccount.derivedDepositWallet ?? null,
    diagnostics: resolvedAccount.diagnostics,
    accountSnapshot,
    market: summarizeValidationMarket(market),
    positions,
    suggestions,
  };
}

async function runTestOrderPreview(
  config: ExecutorAppConfig,
  options: {
    outcome: "Up" | "Down";
    notional: number;
  },
) {
  const issues = validateAppConfig(config);
  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  if (!(options.notional > 0)) {
    throw new Error("测试单金额必须大于 0。");
  }

  const executorConfig = buildExecutorConfigFromAppConfig(config);
  const session = await resolveSessionContext(executorConfig);
  const client = createTradingClient(executorConfig, session);
  if (executorConfig.accountMode === "deposit_wallet_1271") {
    await syncCollateralAllowance(client).catch(() => undefined);
  }
  const market = await locateCurrentBtc1hMarket(executorConfig, {
    targetTime: new Date(),
    requireExactStart: true,
  });
  if (!market) {
    throw new Error("当前没有定位到可用于测试的 BTC 1H 市场。");
  }

  const selectedToken = market.outcomes.find((item) => item.outcome.toLowerCase() === options.outcome.toLowerCase()) ?? null;
  if (!selectedToken) {
    throw new Error(`当前市场没有找到 ${options.outcome} 方向的 token。`);
  }

  const staticPrice = Number(selectedToken.price);
  const quotedPrice = Number((await client.calculateMarketPrice(selectedToken.tokenId, Side.BUY, options.notional)).toFixed(6));
  const effectivePrice = quotedPrice > 0 ? quotedPrice : staticPrice;
  const size = computePreviewOrderSize(options.notional, effectivePrice);

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    accountMode: executorConfig.accountMode,
    outcome: options.outcome,
    targetNotional: Number(options.notional.toFixed(6)),
    market: summarizeValidationMarket(market),
    selectedToken: {
      outcome: selectedToken.outcome,
      tokenId: selectedToken.tokenId,
      staticPrice,
      quotedPrice,
      effectivePrice,
      estimatedSize: size,
    },
    orderIntentPreview: {
      side: "BUY",
      tokenId: selectedToken.tokenId,
      price: effectivePrice,
      size,
      amount: Number(options.notional.toFixed(6)),
      orderType: "FOK",
    },
    warnings: [
      "这只是测试单预览，不会真正提交订单。",
      executorConfig.accountMode === "poly_proxy"
        ? "POLY_PROXY 模式下请再次确认 walletAddress 是 signer，funderAddress 是站内 proxy wallet。"
        : executorConfig.accountMode === "deposit_wallet_1271"
          ? "Deposit Wallet 模式下请确认 walletAddress 是 signer，funderAddress 是 deposit wallet；若未手填，系统会使用自动推导结果。"
          : "EOA 模式下请确认 walletAddress 与 funderAddress 的关系符合您当前老系统习惯。",
      "真实小额测试时，建议先从最小可接受金额开始，并优先使用单独测试账户。",
    ],
  };
}

async function submitControlledTestOrder(
  config: ExecutorAppConfig,
  options: {
    outcome: "Up" | "Down";
    notional: number;
    confirmed: boolean;
  },
) {
  const issues = validateAppConfig(config);
  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  if (!options.confirmed) {
    throw new Error("请先勾选确认框，再提交真实测试单。");
  }
  if (!(options.notional > 0)) {
    throw new Error("测试单金额必须大于 0。");
  }
  if (options.notional > MAX_LIVE_TEST_NOTIONAL) {
    throw new Error(`测试单金额不能超过 ${MAX_LIVE_TEST_NOTIONAL} U。`);
  }

  const executorConfig = buildExecutorConfigFromAppConfig(config);
  const resolvedAccount = await resolveAccountContext(executorConfig);
  const runtimeState = loadRuntimeState(executorConfig.stateFile);
  const session = await resolveSessionContext(executorConfig);
  let nextState = applySessionSnapshot(runtimeState, session);
  const client = createTradingClient(executorConfig, session);
  if (executorConfig.accountMode === "deposit_wallet_1271") {
    await syncCollateralAllowance(client).catch(() => undefined);
  }
  const accountSnapshot = await getCollateralSnapshot(client, session);
  nextState = applyAccountSnapshot(nextState, accountSnapshot);

  const market = await locateCurrentBtc1hMarket(executorConfig, {
    targetTime: new Date(),
    requireExactStart: true,
  });
  if (!market) {
    throw new Error("当前没有定位到可用于测试的 BTC 1H 市场。");
  }

  const selectedToken = market.outcomes.find((item) => item.outcome.toLowerCase() === options.outcome.toLowerCase()) ?? null;
  if (!selectedToken) {
    throw new Error(`当前市场没有找到 ${options.outcome} 方向的 token。`);
  }

  const quotedPrice = Number((await client.calculateMarketPrice(selectedToken.tokenId, Side.BUY, options.notional)).toFixed(6));
  if (!(quotedPrice > 0)) {
    throw new Error("当前无法获取有效市场价格，请稍后重试。");
  }
  const size = computePreviewOrderSize(options.notional, quotedPrice);
  const orderIntent = {
    tokenId: selectedToken.tokenId,
    side: "BUY" as const,
    price: quotedPrice,
    size,
    amount: Number(options.notional.toFixed(6)),
    orderType: "FOK" as const,
  };

  appendExecutionEvent(executorConfig.eventsLogFile, {
    timestamp: new Date().toISOString(),
    eventType: "GUI_TEST_ORDER_SUBMITTING",
    message: "Submitting controlled live test order from GUI.",
    tokenId: orderIntent.tokenId,
    payload: {
      accountMode: executorConfig.accountMode,
      outcome: options.outcome,
      targetNotional: options.notional,
      orderIntent,
    },
  });

  const postResult = (await postLimitOrder(client, orderIntent)) as Record<string, unknown>;
  const orderId = String(postResult.orderID ?? "");

  let orderSnapshot = orderId ? await getOrderSnapshot(client, orderId) : null;
  if (orderSnapshot) {
    nextState = applyOrderSnapshot(nextState, orderSnapshot);
  }

  const tradeSnapshot = orderId ? await getTradesForOrder(client, orderId, session.funderAddress) : null;
  if (tradeSnapshot) {
    nextState = applyTradeSnapshot(nextState, tradeSnapshot);
  }

  const positionSnapshot = await getFreshPositionSnapshot(
    executorConfig,
    session,
    orderSnapshot?.tokenId || orderIntent.tokenId,
    Boolean(tradeSnapshot?.count),
  );
  nextState = applyPositionSnapshot(nextState, positionSnapshot);

  let cancelResult: unknown = null;
  if (orderSnapshot && orderId && isOpenOrderStatus(orderSnapshot.status)) {
    try {
      cancelResult = await cancelOrder(client, orderId);
      orderSnapshot = await getOrderSnapshot(client, orderId);
      nextState = applyOrderSnapshot(nextState, orderSnapshot);
    } catch (error) {
      cancelResult = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  saveRuntimeState(executorConfig.stateFile, nextState);

  appendExecutionEvent(executorConfig.eventsLogFile, {
    timestamp: new Date().toISOString(),
    eventType: "GUI_TEST_ORDER_SUBMITTED",
    message: "Controlled live test order finished.",
    orderId: orderId || undefined,
    tokenId: orderIntent.tokenId,
    payload: {
      accountMode: executorConfig.accountMode,
      outcome: options.outcome,
      targetNotional: options.notional,
      postResult,
      orderSnapshot,
      tradeSnapshot,
      positionSnapshot,
      cancelResult,
    },
  });

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    accountMode: executorConfig.accountMode,
    liveOrderSubmitted: true,
    maxAllowedNotional: MAX_LIVE_TEST_NOTIONAL,
    session: {
      walletAddress: session.walletAddress,
      funderAddress: session.funderAddress,
      signatureType: session.signatureType,
    },
    derivedDepositWallet: resolvedAccount.derivedDepositWallet ?? null,
    accountSnapshot,
    market: summarizeValidationMarket(market),
    selectedToken: {
      outcome: selectedToken.outcome,
      tokenId: selectedToken.tokenId,
      quotedPrice,
      estimatedSize: size,
    },
    orderIntent,
    orderId,
    postResult,
    orderSnapshot,
    tradeSnapshot,
    positionSnapshot,
    cancelResult,
    warnings: [
      "这一步已经是真实下单验证，请务必使用小额和隔离测试账户。",
      executorConfig.accountMode === "deposit_wallet_1271"
        ? "如果 Polymarket 后台出现真实订单，说明 deposit wallet flow 的核心下单链路已经打通。"
        : "如果 Polymarket 后台出现真实订单，说明邮箱模式的核心下单链路已经打通。",
      "如果订单状态显示为 open/live，系统已尝试自动撤单以避免残留挂单。",
    ],
  };
}

function resolveGuiPathTarget(cli: CliArgs, key: string): string | null {
  const match = buildGuiPathEntries(cli).find((entry) => entry.key === key);
  return match?.path ?? null;
}

function getResearchRoot(): string {
  return path.resolve(process.cwd(), "..");
}

function enumerateBinaryPatterns(patternLen: number): string[] {
  const total = 2 ** patternLen;
  const patterns: string[] = [];
  for (let bits = 0; bits < total; bits += 1) {
    let pattern = "";
    for (let index = 0; index < patternLen; index += 1) {
      pattern += ((bits >> index) & 1) === 1 ? "U" : "D";
    }
    patterns.push(pattern);
  }
  return patterns;
}

function countCsvCandles(csvPath: string): number {
  if (!fs.existsSync(csvPath)) {
    return 0;
  }
  const raw = fs.readFileSync(csvPath, "utf8").trim();
  if (!raw) {
    return 0;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return Math.max(0, lines.length - 1);
}

function scaleProgress(value: number, start: number, end: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(start + ((end - start) * clamped) / 100);
}

async function refreshResearchBinanceCsv(
  onProgress?: (patch: {
    stage?: string;
    detail?: string;
    progressPercent?: number;
  }) => void,
): Promise<Record<string, unknown>> {
  const researchRoot = getResearchRoot();
  const scriptPath = path.join(researchRoot, "scripts", "refresh_binance_dataset.py");
  const csvPath = path.join(researchRoot, "data", "raw", "binance", "BTCUSDT_1h_365d.csv");
  onProgress?.({
    stage: "刷新 Binance 数据",
    detail: "正在下载最新 BTCUSDT 1H 数据，并准备进行质量校验。",
    progressPercent: 2,
  });

  return runProcessJsonProgress(
    "python",
    [scriptPath, "--csv", csvPath, "--symbol", "BTCUSDT", "--days", "365", "--base-url", "https://api.binance.com"],
    researchRoot,
    (payload) => {
      if (payload.type !== "progress") {
        return;
      }
      onProgress?.({
        stage: typeof payload.stage === "string" ? payload.stage : "刷新 Binance 数据",
        detail: typeof payload.detail === "string" ? payload.detail : "",
        progressPercent:
          typeof payload.progress_percent === "number"
            ? scaleProgress(Number(payload.progress_percent), 2, 12)
            : undefined,
      });
    },
    buildPythonUtf8Env(),
  );
}

function getStrategyCatalogForGui(cli: CliArgs) {
  const editable = loadEditableConfig(cli.configFile);
  const issues = editable.exists ? validateAppConfig(editable.config) : [];
  const executorConfig =
    editable.exists && issues.length === 0 ? buildExecutorConfigFromAppConfig(editable.config) : loadExecutorConfig();
  const strategyRoot = path.dirname((editable.config?.trading.strategyDir ?? executorConfig.strategyDir) || executorConfig.strategyDir);
  const catalog = listStrategyCatalog(strategyRoot);
  return {
    strategyRoot,
    config: editable.config,
    catalog,
  };
}

function makeStrategyRescanJob(scope: string): StrategyRescanProgress {
  return {
    jobId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    scope,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    total: 0,
    completed: 0,
    currentKey: "",
    currentVersion: "",
    stage: "准备中",
    detail: "正在整理候选策略。",
    progressPercent: 0,
    results: [],
    error: "",
  };
}

function updateStrategyRescanJob(
  job: StrategyRescanProgress,
  patch: Partial<Omit<StrategyRescanProgress, "jobId" | "scope" | "startedAt" | "results">> & {
    appendResult?: Record<string, unknown>;
  },
): void {
  job.status = patch.status ?? job.status;
  job.finishedAt = patch.finishedAt ?? job.finishedAt;
  job.total = patch.total ?? job.total;
  job.completed = patch.completed ?? job.completed;
  job.currentKey = patch.currentKey ?? job.currentKey;
  job.currentVersion = patch.currentVersion ?? job.currentVersion;
  job.stage = patch.stage ?? job.stage;
  job.detail = patch.detail ?? job.detail;
  job.progressPercent = patch.progressPercent ?? job.progressPercent;
  job.error = patch.error ?? job.error;
  if (patch.appendResult) {
    job.results.push(patch.appendResult);
  }
}

async function rescanStrategyCandidates(
  cli: CliArgs,
  scope: string,
  onProgress?: (patch: {
    total?: number;
    completed?: number;
    currentKey?: string;
    currentVersion?: string;
    stage?: string;
    detail?: string;
    progressPercent?: number;
    appendResult?: Record<string, unknown>;
  }) => void,
): Promise<unknown> {
  const { strategyRoot, config, catalog } = getStrategyCatalogForGui(cli);
  const selectedDir = config.trading.strategyDir;
  const targets = catalog.filter((entry) => {
    if (scope === "selected") {
      return entry.dir === selectedDir;
    }
    return true;
  });

  if (targets.length === 0) {
    throw new Error("当前没有可重扫的候选策略。");
  }

  onProgress?.({
    total: targets.length,
    completed: 0,
    stage: "已锁定候选策略",
    detail: `本次将重算 ${targets.length} 套候选策略。`,
    progressPercent: 5,
  });

  const researchRoot = getResearchRoot();
  const exportScript = path.join(researchRoot, "scripts", "export_strategy_bundle.py");
  const csvPath = path.join(researchRoot, "data", "raw", "binance", "BTCUSDT_1h_365d.csv");
  const candleCount = countCsvCandles(csvPath);
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < targets.length; index += 1) {
    const entry = targets[index];
    const maxTrainWindowDays = Math.max(
      30,
      Math.floor((candleCount - 6 - entry.riskHorizonH - entry.stepDays * 24) / 24),
    );
    const effectiveTrainWindowDays =
      candleCount > 0 ? Math.max(30, Math.min(entry.trainWindowDays, maxTrainWindowDays)) : entry.trainWindowDays;
    const baseProgress = 10 + Math.floor((index / targets.length) * 80);
    onProgress?.({
      total: targets.length,
      completed: index,
      currentKey: entry.key,
      currentVersion: entry.version,
      stage: "正在重算单套策略",
      detail: `正在重算 ${entry.version}，pattern=${entry.pattern}，coverage=${entry.coverageTarget}。`,
      progressPercent: baseProgress,
    });
    const args = [
      exportScript,
      "--csv",
      csvPath,
      "--pattern",
      entry.pattern,
      "--coverage",
      String(entry.coverageTarget),
      "--risk-horizon",
      String(entry.riskHorizonH),
      "--train-window-days",
      String(effectiveTrainWindowDays),
      "--step-days",
      String(entry.stepDays),
      "--base-stake",
      String(config.trading.baseStakeU ?? entry.baseStakeU),
      "--version",
      entry.version,
      "--out-dir",
      strategyRoot,
    ];
    const output = await runProcess("python", args, researchRoot, buildPythonUtf8Env());
    const result = {
      key: entry.key,
      version: entry.version,
      pattern: entry.pattern,
      coverageTarget: entry.coverageTarget,
      trainWindowDays: effectiveTrainWindowDays,
      stdout: output.stdout.trim(),
    };
    results.push(result);
    onProgress?.({
      total: targets.length,
      completed: index + 1,
      currentKey: entry.key,
      currentVersion: entry.version,
      stage: "已完成一套策略",
      detail: `已完成 ${index + 1}/${targets.length}：${entry.version}。`,
      progressPercent: 10 + Math.floor(((index + 1) / targets.length) * 80),
      appendResult: result,
    });
  }

  onProgress?.({
    total: targets.length,
    completed: targets.length,
    stage: "正在刷新策略中心",
    detail: "候选策略已重算完成，正在刷新推荐结果。",
    progressPercent: 100,
  });

  return {
    ok: true,
    scope,
    refreshedAt: new Date().toISOString(),
    strategyRoot,
    results,
  };
}

async function runFullStrategyScan(
  cli: CliArgs,
  onProgress?: (patch: {
    total?: number;
    completed?: number;
    currentKey?: string;
    currentVersion?: string;
    stage?: string;
    detail?: string;
    progressPercent?: number;
    appendResult?: Record<string, unknown>;
  }) => void,
): Promise<Record<string, unknown>> {
  const { strategyRoot, config } = getStrategyCatalogForGui(cli);
  const researchRoot = getResearchRoot();
  const scriptPath = path.join(researchRoot, "scripts", "full_strategy_scan.py");
  const csvPath = path.join(researchRoot, "data", "raw", "binance", "BTCUSDT_1h_365d.csv");
  const refreshSummary = await refreshResearchBinanceCsv(onProgress);
  const patterns = enumerateBinaryPatterns(6);
  const coverages = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"];
  const args = [
    scriptPath,
    "--csv",
    csvPath,
    "--patterns",
    patterns.join(","),
    "--coverages",
    coverages.join(","),
    "--risk-horizon",
    "72",
    "--train-ratio",
    "0.75",
    "--train-window-days",
    "334",
    "--step-days",
    "7",
    "--base-stake",
    String(config.trading.baseStakeU ?? 2),
    "--version-prefix",
    "auto",
    "--out-dir",
    strategyRoot,
  ];

  onProgress?.({
    total: patterns.length,
    completed: 0,
    stage: "准备全量扫描",
    detail: `数据已刷新并通过质量校验，正在准备 ${patterns.length} 个 pattern、coverage 区间和输出目录；训练窗口默认按 334 天执行。`,
    progressPercent: 15,
  });

  const summary = await runProcessJsonProgress("python", args, researchRoot, (payload) => {
    if (payload.type !== "progress") {
      return;
    }
    const completedPatterns =
      typeof payload.completed_patterns === "number" ? Number(payload.completed_patterns) : undefined;
    const totalPatterns = typeof payload.total_patterns === "number" ? Number(payload.total_patterns) : undefined;
    const currentPattern = typeof payload.current_pattern === "string" ? payload.current_pattern : "";
    const currentVersion = typeof payload.current_version === "string" ? payload.current_version : currentPattern;
    onProgress?.({
      total: totalPatterns,
      completed: completedPatterns,
      currentKey: currentPattern,
      currentVersion,
      stage: typeof payload.stage === "string" ? payload.stage : "全量扫描中",
      detail: typeof payload.detail === "string" ? payload.detail : "",
      progressPercent:
        typeof payload.progress_percent === "number"
          ? scaleProgress(Number(payload.progress_percent), 15, 100)
          : undefined,
    });
  }, buildPythonUtf8Env());

  const candidates = Array.isArray(summary.candidates) ? (summary.candidates as Array<Record<string, unknown>>) : [];
  for (const candidate of candidates) {
    onProgress?.({
      appendResult: candidate,
    });
  }
  onProgress?.({
    total: candidates.length || patterns.length,
    completed: candidates.length || patterns.length,
    currentKey: String(summary.recommended_version ?? ""),
    currentVersion: String(summary.recommended_version ?? ""),
    stage: "全量重算并选优完成",
    detail: `已导出 ${candidates.length} 套候选策略，推荐策略为 ${String(summary.recommended_version ?? "未知")}`,
    progressPercent: 100,
  });

  return {
    ok: true,
    mode: "full_scan",
    refreshedAt: new Date().toISOString(),
    strategyRoot,
    dataRefresh: refreshSummary,
    summary,
    results: candidates,
  };
}

async function openPathInFileManager(targetPath: string): Promise<void> {
  const fallbackPath = path.dirname(targetPath);
  const resolvedPath = fs.existsSync(targetPath) ? targetPath : fallbackPath;

  await new Promise<void>((resolve, reject) => {
    let command = "xdg-open";
    let args = [resolvedPath];
    if (process.platform === "win32") {
      command = "explorer.exe";
      args = [resolvedPath];
    } else if (process.platform === "darwin") {
      command = "open";
      args = [resolvedPath];
    }

    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse, cli: CliArgs): Promise<boolean> {
  const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (req.method === "GET" && reqUrl.pathname === "/api/state") {
    sendJson(
      res,
      200,
      buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    );
    return true;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      mode: "app_gui_health",
      generatedAt: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/config/raw") {
    const editable = loadEditableConfig(cli.configFile);
    sendJson(res, 200, {
      mode: "config_raw",
      filePath: cli.configFile,
      exists: editable.exists,
      config: editable.config,
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/config/save") {
    const body = await readJsonBody(req);
    const nextConfig = (body.config ?? null) as ExecutorAppConfig | null;
    if (!nextConfig) {
      sendJson(res, 400, { ok: false, error: "Missing config object." });
      return true;
    }
    const issues = validateAppConfig(nextConfig);
    if (issues.length > 0) {
      sendJson(res, 400, { ok: false, issues });
      return true;
    }
    saveAppConfig(cli.configFile, nextConfig);
    sendJson(res, 200, {
      ok: true,
      filePath: cli.configFile,
      issues: [],
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/account/validate") {
    const body = await readJsonBody(req);
    const nextConfig = (body.config ?? null) as ExecutorAppConfig | null;
    const candidateConfig = nextConfig ?? loadEditableConfig(cli.configFile).config;
    const result = await runReadonlyAccountValidation(candidateConfig);
    if (!result.ok) {
      sendJson(res, 400, {
        ok: false,
        mode: "account_readonly_validation",
        issues: result.issues,
      });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      mode: "account_readonly_validation",
      result,
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/order/preview") {
    const body = await readJsonBody(req);
    const nextConfig = (body.config ?? null) as ExecutorAppConfig | null;
    const outcome = body.outcome === "Down" ? "Down" : "Up";
    const notional = Number(body.notional ?? 0);
    const candidateConfig = nextConfig ?? loadEditableConfig(cli.configFile).config;
    const result = await runTestOrderPreview(candidateConfig, {
      outcome,
      notional,
    });
    if (!result.ok) {
      sendJson(res, 400, {
        ok: false,
        mode: "test_order_preview",
        issues: result.issues,
      });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      mode: "test_order_preview",
      result,
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/order/submit-test") {
    const body = await readJsonBody(req);
    const nextConfig = (body.config ?? null) as ExecutorAppConfig | null;
    const outcome = body.outcome === "Down" ? "Down" : "Up";
    const notional = Number(body.notional ?? 0);
    const confirmed = body.confirmed === true;
    const candidateConfig = nextConfig ?? loadEditableConfig(cli.configFile).config;
    const result = await submitControlledTestOrder(candidateConfig, {
      outcome,
      notional,
      confirmed,
    });
    if (!result.ok) {
      sendJson(res, 400, {
        ok: false,
        mode: "submit_controlled_test_order",
        issues: result.issues,
      });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      mode: "submit_controlled_test_order",
      result,
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && /^\/api\/daemon\/(start|stop|restart)$/.test(reqUrl.pathname)) {
    const action = reqUrl.pathname.split("/").pop()!;
    const body = await readJsonBody(req);
    const args = [action, "--config", cli.configFile];
    if (typeof body.intervalMs === "number") {
      args.push("--interval-ms", String(body.intervalMs));
    }
    if (body.execute === true) {
      args.push("--execute");
    }
    if (body.commitState === false) {
      args.push("--no-commit-state");
    }
    const result = await runTsxJson("daemon_service.ts", args);
    sendJson(res, 200, {
      ok: true,
      action,
      result,
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && /^\/api\/runtime\/(pause|resume)$/.test(reqUrl.pathname)) {
    const action = reqUrl.pathname.split("/").pop()!;
    const body = await readJsonBody(req);
    const args = [action, "--config", cli.configFile];
    if (action === "pause") {
      args.push("--code", String(body.code ?? "MANUAL_PAUSE"));
    }
    if (typeof body.reason === "string" && body.reason.trim()) {
      args.push("--reason", body.reason.trim());
    }
    const result = await runTsxJson("runtime_control.ts", args);
    sendJson(res, 200, {
      ok: true,
      action,
      result,
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/system/paths") {
    sendJson(res, 200, {
      mode: "gui_paths",
      entries: buildGuiPathEntries(cli),
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/system/open-path") {
    const body = await readJsonBody(req);
    const target = typeof body.target === "string" ? body.target : "";
    const targetPath = resolveGuiPathTarget(cli, target);
    if (!targetPath) {
      sendJson(res, 400, { ok: false, error: "Unknown target path." });
      return true;
    }
    await openPathInFileManager(targetPath);
    sendJson(res, 200, {
      ok: true,
      target,
      path: targetPath,
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/strategy/rescan") {
    const body = await readJsonBody(req);
    const scope = typeof body.scope === "string" ? body.scope : "all";
    const mode = typeof body.mode === "string" ? body.mode : "incremental";
    const result =
      mode === "full_scan" ? await runFullStrategyScan(cli) : await rescanStrategyCandidates(cli, scope);
    sendJson(res, 200, {
      ...((result ?? {}) as Record<string, unknown>),
      state: buildAppUiState({
        configFile: cli.configFile,
        staleAfterMs: cli.staleAfterMs,
        logLimit: cli.logLimit,
      }),
    });
    return true;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/strategy/rescan/start") {
    const body = await readJsonBody(req);
    const scope = typeof body.scope === "string" ? body.scope : "all";
    const mode = typeof body.mode === "string" ? body.mode : "incremental";
    const job = makeStrategyRescanJob(scope);
    strategyRescanJobs.set(job.jobId, job);
    const runner = mode === "full_scan" ? runFullStrategyScan(cli, (patch) => {
      updateStrategyRescanJob(job, patch);
    }) : rescanStrategyCandidates(cli, scope, (patch) => {
      updateStrategyRescanJob(job, patch);
    });
    void runner
      .then(() => {
        updateStrategyRescanJob(job, {
          status: "done",
          finishedAt: new Date().toISOString(),
          stage: mode === "full_scan" ? "全量重算并选优完成" : "策略重算完成",
          detail:
            mode === "full_scan"
              ? `已完成全量扫描，当前推荐策略为 ${job.currentVersion || "未知"}。`
              : `已完成 ${job.completed}/${job.total} 套候选策略重算。`,
          progressPercent: 100,
        });
      })
      .catch((error) => {
        updateStrategyRescanJob(job, {
          status: "error",
          finishedAt: new Date().toISOString(),
          stage: "策略重算失败",
          detail: "研究层脚本返回错误，请查看详情。",
          progressPercent: 100,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    sendJson(res, 200, {
      ok: true,
      jobId: job.jobId,
      scope,
      mode,
      status: job.status,
    });
    return true;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/strategy/rescan/status") {
    const jobId = reqUrl.searchParams.get("jobId") ?? "";
    if (!jobId || !strategyRescanJobs.has(jobId)) {
      sendJson(res, 404, { ok: false, error: "未找到对应的策略重算任务。" });
      return true;
    }
    const job = strategyRescanJobs.get(jobId)!;
    sendJson(res, 200, {
      ok: true,
      job,
      state:
        job.status === "done"
          ? buildAppUiState({
              configFile: cli.configFile,
              staleAfterMs: cli.staleAfterMs,
              logLimit: cli.logLimit,
            })
          : null,
    });
    return true;
  }

  return false;
}

export async function runGuiServer(argv = process.argv.slice(2)): Promise<void> {
  const cli = parseArgs(argv);
  if (cli.help) {
    printHelp();
    return;
  }

  ensureEditableConfigFile(cli.configFile);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/api/")) {
        const handled = await handleApiRequest(req, res, cli);
        if (!handled) {
          sendJson(res, 404, { ok: false, error: "API route not found." });
        }
        return;
      }
      serveStatic(new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`).pathname, res);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cli.port, cli.host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : cli.port;

  console.log(
    JSON.stringify({
      mode: "app_gui_server_started",
      host: cli.host,
      port: actualPort,
      configFile: cli.configFile,
      url: `http://${cli.host}:${actualPort}/`,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGuiServer().catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
