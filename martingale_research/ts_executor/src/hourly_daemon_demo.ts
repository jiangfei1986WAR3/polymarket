import { Side } from "@polymarket/clob-client-v2";
import { getCollateralSnapshot } from "./account.js";
import { pathToFileURL } from "node:url";
import { attemptAutoRedeemWinningPosition, type AutoRedeemAttemptResult } from "./auto_redeem.js";
import { fetchRecentClosedBinance1hCandles, recentStateString } from "./binance_state.js";
import { reconcileExecutionForOrder } from "./execution_reconciler.js";
import { resolveSessionContext } from "./auth.js";
import { createTradingClient } from "./client.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { cancelOrder, getOrderSnapshot, postLimitOrder } from "./orders.js";
import { pauseRuntimeState, resumeRuntimeState } from "./pause_controller.js";
import {
  applyOutcomeToRisk,
  clearApiFailureCounter,
  evaluateRiskLimits,
  normalizeRiskState,
  registerApiFailure,
} from "./risk_guard.js";
import {
  applyAccountSnapshot,
  applyOrderSnapshot,
  applyRedemptionState,
  applyRiskState,
  applyRunState,
  applySessionSnapshot,
  loadRuntimeState,
  saveRuntimeState,
} from "./state.js";
import { evaluateStrategyDecision } from "./state_gate.js";
import { loadStrategyBundle } from "./strategy_loader.js";
import type { CandleSnapshot, ExecutionReconciliation, OrderIntent, RuntimeStateV2, StrategyConfigBundle } from "./types.js";

interface CliArgs {
  at?: string;
  execute: boolean;
  commitState: boolean;
  force: boolean;
  help: boolean;
  orderType: "GTC" | "FOK" | "FAK" | "GTD";
  price?: number;
}

export interface HourlyDaemonRunOptions {
  argv?: string[];
  printOutput?: boolean;
}

export type HourlyDaemonResult = Record<string, unknown>;

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    execute: false,
    commitState: false,
    force: false,
    help: false,
    orderType: "FOK",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--at":
        out.at = next;
        i += 1;
        break;
      case "--price":
        out.price = Number(next);
        i += 1;
        break;
      case "--order-type":
        if (next === "GTD" || next === "GTC" || next === "FOK" || next === "FAK") {
          out.orderType = next;
        }
        i += 1;
        break;
      case "--execute":
        out.execute = true;
        break;
      case "--commit-state":
        out.commitState = true;
        break;
      case "--force":
        out.force = true;
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
  console.log("  npm run hourly-daemon --");
  console.log("  npm run hourly-daemon -- --commit-state");
  console.log("  npm run hourly-daemon -- --execute --order-type FOK");
  console.log("");
  console.log("Notes:");
  console.log("  - Default mode is dry-run and does not save state.");
  console.log("  - Use --commit-state to persist the previewed state transition.");
  console.log("  - Use --execute to place a live order and persist state.");
  console.log("  - Default live order type is FOK to avoid stale resting orders.");
  console.log("  - Use --force to bypass the already-processed hourly guard.");
}

function emitResult(result: HourlyDaemonResult, printOutput: boolean): HourlyDaemonResult {
  if (printOutput) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function floorToHour(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours()));
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function computeTargetNotional(baseStakeU: number, step: number): number {
  return Number((baseStakeU * 2 ** (step - 1)).toFixed(6));
}

function computeOrderSize(targetNotional: number, price: number): number {
  if (!(price > 0)) {
    throw new Error(`Order price must be positive, got ${price}`);
  }
  return Number((targetNotional / price).toFixed(6));
}

function candleDirection(candle: CandleSnapshot): "U" | "D" {
  return candle.close >= candle.open ? "U" : "D";
}

function summarizeMarket(
  market:
    | {
        marketId: string;
        slug: string;
        question: string;
        eventTitle: string;
        eventStartTime: string;
        endDate: string;
        tickSize: number;
        orderMinSize: number;
        acceptingOrders: boolean;
        outcomes: Array<{ outcome: string; tokenId: string; price: string }>;
      }
    | null,
) {
  if (!market) {
    return null;
  }
  return {
    marketId: market.marketId,
    slug: market.slug,
    question: market.question,
    eventTitle: market.eventTitle,
    eventStartTime: market.eventStartTime,
    endDate: market.endDate,
    tickSize: market.tickSize,
    orderMinSize: market.orderMinSize,
    acceptingOrders: market.acceptingOrders,
    outcomes: market.outcomes,
  };
}

function summarizeReconciliation(reconciliation: ExecutionReconciliation | null) {
  if (!reconciliation) {
    return null;
  }
  return {
    orderId: reconciliation.orderId,
    tokenId: reconciliation.tokenId,
    orderStatus: reconciliation.orderStatus,
    orderFound: reconciliation.orderFound,
    tradeCount: reconciliation.tradeCount,
    tradeIds: reconciliation.tradeIds,
    latestTradePrice: reconciliation.latestTradePrice,
    latestTradeSide: reconciliation.latestTradeSide,
    latestTradeStatus: reconciliation.latestTradeStatus,
    positionFound: reconciliation.positionFound,
    positionSize: reconciliation.positionSize,
    positionSide: reconciliation.positionSide,
    positionEntryPrice: reconciliation.positionEntryPrice,
    inferredStatus: reconciliation.inferredStatus,
  };
}

function summarizeRisk(state: RuntimeStateV2) {
  return {
    paused: state.risk.paused,
    pauseCode: state.risk.pauseCode,
    pauseReason: state.risk.pauseReason,
    consecutiveBlowups: state.risk.consecutiveBlowups,
    consecutiveApiFailures: state.risk.consecutiveApiFailures,
    dailyLossU: state.risk.dailyLossU,
    dailyLossDate: state.risk.dailyLossDate,
    lastGuardDecision: state.risk.lastGuardDecision,
  };
}

function isOpenOrderStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "LIVE" || normalized === "OPEN";
}

function isAcceptedEntryStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return (
    normalized === "MATCHED" ||
    normalized === "DELAYED" ||
    normalized === "MINED" ||
    normalized === "CONFIRMED"
  );
}

function isMissedEntryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  return (
    normalized.includes("FOK_ORDER_NOT_FILLED_ERROR") ||
    normalized.includes("NO MATCH") ||
    normalized.includes("NO LIQUIDITY FOR MARKET ORDER")
  );
}

function isMissedReconciliation(reconciliation: ExecutionReconciliation | null): boolean {
  if (!reconciliation) {
    return false;
  }
  return reconciliation.inferredStatus === "MISSED";
}

function summarizeRedemption(result: AutoRedeemAttemptResult | null) {
  if (!result) {
    return null;
  }
  return {
    status: result.status,
    reason: result.reason,
    tokenId: result.tokenId,
    conditionId: result.conditionId,
    marketStartTime: result.marketStartTime,
    transactionId: result.transactionId ?? "",
    transactionHash: result.transactionHash ?? "",
  };
}

function applyAutoRedeemResult(
  state: RuntimeStateV2,
  result: AutoRedeemAttemptResult | null,
): RuntimeStateV2 {
  if (!result) {
    return state;
  }
  return applyRedemptionState(state, {
    status: result.status,
    lastAttemptedTokenId: result.tokenId,
    lastAttemptedConditionId: result.conditionId,
    lastAttemptedMarketStartTime: result.marketStartTime,
    lastSubmittedTokenId: result.status === "submitted" ? result.tokenId : state.redemption.lastSubmittedTokenId,
    lastSubmittedConditionId:
      result.status === "submitted" ? result.conditionId : state.redemption.lastSubmittedConditionId,
    lastTransactionId: result.transactionId ?? state.redemption.lastTransactionId,
    lastTransactionHash: result.transactionHash ?? state.redemption.lastTransactionHash,
    lastError: result.status === "submission_skipped" ? result.reason : "",
    updatedAt: nowIso(),
  });
}

function applyPreviousOutcome(
  state: RuntimeStateV2,
  outcome: "win" | "loss" | null,
  strategy: StrategyConfigBundle,
): RuntimeStateV2["run"] {
  if (outcome === null) {
    return state.run;
  }
  if (!state.run.inRun || state.run.currentStep === null) {
    throw new Error("Cannot apply outcome when no martingale run is active");
  }

  if (outcome === "win") {
    return {
      ...state.run,
      inRun: false,
      currentStep: null,
      lastAction: "RESOLVED_WIN",
      lastReason: "上一小时结果为赢，本轮马丁结束并重置为空仓。",
      updatedAt: nowIso(),
      totalWins: state.run.totalWins + 1,
    };
  }

  const nextStep = state.run.currentStep + 1;
  if (nextStep > strategy.maxSteps) {
    return {
      ...state.run,
      inRun: false,
      currentStep: null,
      lastAction: "RESOLVED_BLOWUP",
      lastReason: "上一小时结果为输，且已达到最大步数，本轮记为爆仓并重置为空仓。",
      updatedAt: nowIso(),
      totalLosses: state.run.totalLosses + 1,
      totalBlowups: state.run.totalBlowups + 1,
    };
  }

  return {
    ...state.run,
    inRun: true,
    currentStep: nextStep,
    lastAction: `ADVANCE_TO_STEP_${nextStep}`,
    lastReason: `上一小时结果为输，本轮推进到第 ${nextStep} 步。`,
    updatedAt: nowIso(),
    totalLosses: state.run.totalLosses + 1,
  };
}

function abortRunAfterMissedEntry(args: {
  state: RuntimeStateV2;
  latestClosedCandle: CandleSnapshot;
  currentState: string;
  reason: string;
}): RuntimeStateV2["run"] {
  const { state, latestClosedCandle, currentState, reason } = args;
  return {
    ...state.run,
    inRun: false,
    currentStep: null,
    lastProcessedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
    pendingDecisionCandleOpenTimeMs: null,
    lastState: currentState,
    lastAction: "ENTRY_MISSED_ABORT_RUN",
    lastDirection: null,
    lastReason: reason,
    pendingDecisionReason: "",
    pauseReason: "",
    updatedAt: nowIso(),
  };
}

function canReconcilePreviousOrder(state: RuntimeStateV2, latestClosedCandle: CandleSnapshot): boolean {
  if (!state.run.inRun || state.run.currentStep === null || state.run.lastDirection === null) {
    return false;
  }
  if (state.run.lastProcessedCandleOpenTimeMs === null) {
    return false;
  }
  if (latestClosedCandle.openTimeMs <= state.run.lastProcessedCandleOpenTimeMs) {
    return false;
  }
  return Boolean(state.orders.lastOrderId);
}

function hasExecutionEvidence(state: RuntimeStateV2): boolean {
  return Boolean(
    state.orders.lastOrderId || state.trades.lastMatchedOrderId || state.positions.lastPositionTokenId,
  );
}

function clearGhostRunState(state: RuntimeStateV2): RuntimeStateV2 {
  if (!state.run.inRun || state.run.currentStep === null || hasExecutionEvidence(state)) {
    return state;
  }
  return {
    ...state,
    run: {
      ...state.run,
      inRun: false,
      currentStep: null,
      lastDirection: null,
      lastAction: "RESET_GHOST_RUN",
      lastReason: "检测到没有真实订单/成交/持仓证据的遗留马丁状态，已自动清理后再继续运行。",
      pauseReason: "",
      updatedAt: nowIso(),
    },
  };
}

function resolvePreviousOutcome(args: {
  state: RuntimeStateV2;
  latestClosedCandle: CandleSnapshot;
  reconciliation: ExecutionReconciliation | null;
}): {
  outcome: "win" | "loss" | null;
  shouldPause: boolean;
  pauseReason: string;
  shouldAbortRun: boolean;
  abortReason: string;
} {
  const { state, latestClosedCandle, reconciliation } = args;
  if (!state.run.inRun || state.run.currentStep === null || state.run.lastDirection === null) {
    return { outcome: null, shouldPause: false, pauseReason: "", shouldAbortRun: false, abortReason: "" };
  }
  if (state.run.lastProcessedCandleOpenTimeMs === null) {
    return { outcome: null, shouldPause: false, pauseReason: "", shouldAbortRun: false, abortReason: "" };
  }
  if (latestClosedCandle.openTimeMs <= state.run.lastProcessedCandleOpenTimeMs) {
    return { outcome: null, shouldPause: false, pauseReason: "", shouldAbortRun: false, abortReason: "" };
  }
  if (!reconciliation) {
    return {
      outcome: null,
      shouldPause: true,
      pauseReason: "上一笔订单缺少对账结果，暂停等待确认。",
      shouldAbortRun: false,
      abortReason: "",
    };
  }
  if (reconciliation.inferredStatus === "OPEN") {
    return {
      outcome: null,
      shouldPause: true,
      pauseReason: "上一笔订单仍处于 OPEN 状态，暂停推进下一步。",
      shouldAbortRun: false,
      abortReason: "",
    };
  }
  if (isMissedReconciliation(reconciliation) || reconciliation.inferredStatus === "NO_EVIDENCE") {
    return {
      outcome: null,
      shouldPause: false,
      pauseReason: "",
      shouldAbortRun: true,
      abortReason: "上一笔应执行的订单未成交或已取消，本轮马丁中止，等待新的开局信号。",
    };
  }
  if (reconciliation.inferredStatus === "UNKNOWN") {
    return {
      outcome: null,
      shouldPause: true,
      pauseReason: "上一笔订单未确认成交或持仓，暂停等待人工或后续对账。",
      shouldAbortRun: false,
      abortReason: "",
    };
  }

  return {
    outcome: state.run.lastDirection === candleDirection(latestClosedCandle) ? "win" : "loss",
    shouldPause: false,
    pauseReason: "",
    shouldAbortRun: false,
    abortReason: "",
  };
}

function buildNextRunState(args: {
  state: RuntimeStateV2;
  latestClosedCandle: CandleSnapshot;
  currentState: string;
  decision: ReturnType<typeof evaluateStrategyDecision>;
}): RuntimeStateV2["run"] {
  const { state, latestClosedCandle, currentState, decision } = args;
  const action = decision.recommendedAction;
  return {
    ...state.run,
    inRun: action === "START_RUN" || action.startsWith("BET_STEP_"),
    currentStep: decision.nextStep,
    lastProcessedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
    pendingDecisionCandleOpenTimeMs: null,
    lastState: currentState,
    lastAction: action,
    lastDirection: decision.nextDirection,
    lastReason: decision.reason,
    pendingDecisionReason: "",
    pauseReason: "",
    updatedAt: nowIso(),
    totalRunsStarted: action === "START_RUN" ? state.run.totalRunsStarted + 1 : state.run.totalRunsStarted,
  };
}

function buildPendingMarketRetryRunState(args: {
  state: RuntimeStateV2;
  latestClosedCandle: CandleSnapshot;
  currentState: string;
  decision: ReturnType<typeof evaluateStrategyDecision>;
  reason: string;
}): RuntimeStateV2["run"] {
  const { state, latestClosedCandle, currentState, decision, reason } = args;
  return {
    ...state.run,
    lastProcessedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
    pendingDecisionCandleOpenTimeMs: latestClosedCandle.openTimeMs,
    lastState: currentState,
    lastAction: "WAIT_MARKET_READY",
    lastReason: reason,
    pendingDecisionReason: reason,
    updatedAt: nowIso(),
    inRun: state.run.inRun,
    currentStep: state.run.currentStep,
    lastDirection: decision.nextDirection,
  };
}

function resolveTargetMarketTime(targetTime: Date): Date {
  return floorToHour(targetTime);
}

function isPendingDecisionRetry(state: RuntimeStateV2, latestClosedCandle: CandleSnapshot): boolean {
  return state.run.pendingDecisionCandleOpenTimeMs === latestClosedCandle.openTimeMs;
}

function getMarketNotReadyReason(args: {
  market: Awaited<ReturnType<typeof locateCurrentBtc1hMarket>>;
  selectedOutcome: string | null;
  selectedToken: { tokenId: string; price: string } | null;
  targetMarketTime: Date;
}): string | null {
  const { market, selectedOutcome, selectedToken, targetMarketTime } = args;
  if (!market) {
    return `目标小时 ${targetMarketTime.toISOString()} 的新盘口尚未出现在接口中，等待下次轮询重试。`;
  }
  if (!market.acceptingOrders || !market.active || market.closed) {
    return `目标小时 ${targetMarketTime.toISOString()} 的盘口已找到，但尚未 ready（acceptingOrders=${market.acceptingOrders}, active=${market.active}, closed=${market.closed}）。`;
  }
  if (selectedOutcome && !selectedToken) {
    return `目标小时 ${targetMarketTime.toISOString()} 的盘口已找到，但 ${selectedOutcome} 方向 token 仍未 ready。`;
  }
  if (selectedToken && !(Number(selectedToken.price) > 0)) {
    return `目标小时 ${targetMarketTime.toISOString()} 的盘口已找到，但 ${selectedOutcome} 方向价格暂未 ready。`;
  }
  return null;
}

function buildOrderIntent(args: {
  baseStakeU: number;
  step: number | null;
  selectedToken: { tokenId: string; price: string } | null;
  orderType: "GTC" | "FOK" | "FAK" | "GTD";
  overridePrice?: number;
}): OrderIntent | null {
  const { baseStakeU, step, selectedToken, orderType, overridePrice } = args;
  if (step === null || !selectedToken) {
    return null;
  }
  const targetNotional = computeTargetNotional(baseStakeU, step);
  const price = overridePrice ?? Number(selectedToken.price);
  if (!(price > 0)) {
    return null;
  }
  return {
    tokenId: selectedToken.tokenId,
    side: "BUY",
    price,
    size: computeOrderSize(targetNotional, price),
    amount: targetNotional,
    orderType,
  };
}

export async function runHourlyDaemon(options: HourlyDaemonRunOptions = {}): Promise<HourlyDaemonResult> {
  const printOutput = options.printOutput ?? false;
  const cli = parseArgs(options.argv ?? process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return emitResult({ mode: "help" }, printOutput);
  }

  const config = loadExecutorConfig();
  const targetTime = cli.at ? new Date(cli.at) : new Date();
  if (Number.isNaN(targetTime.getTime())) {
    throw new Error(`Invalid --at value: ${cli.at}`);
  }

  const { strategy, allowedStates } = loadStrategyBundle(config.strategyDir, {
    baseStakeUOverride: config.baseStakeU,
  });
  const candles = await fetchRecentClosedBinance1hCandles(config, 8, targetTime);
  const latestClosedCandle = candles[candles.length - 1];
  const currentState = recentStateString(candles, 6);
  let autoRedeemResult: AutoRedeemAttemptResult | null = null;

  let runtimeState = loadRuntimeState(config.stateFile);
  runtimeState = normalizeRiskState(runtimeState, targetTime);
  const hadGhostRun = runtimeState.run.inRun && runtimeState.run.currentStep !== null && !hasExecutionEvidence(runtimeState);
  if (hadGhostRun) {
    runtimeState = clearGhostRunState(runtimeState);
    if (runtimeState.risk.paused && runtimeState.risk.pauseCode === "AWAITING_RECONCILIATION") {
      runtimeState = resumeRuntimeState(
        runtimeState,
        "Cleared stale martingale state with no live order, trade, or position evidence.",
        "STALE_RUN_CLEARED",
      );
    }
    if (cli.commitState || cli.execute) {
      saveRuntimeState(config.stateFile, runtimeState);
    }
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "RUNTIME_GHOST_RUN_RESET",
      message: "Cleared stale in-run martingale state because no live order, trade, or position evidence existed.",
      payload: {
        lastAction: runtimeState.run.lastAction,
        pauseCode: runtimeState.risk.pauseCode,
        paused: runtimeState.risk.paused,
      },
    });
  }
  if (runtimeState.risk.paused) {
    return emitResult(
      {
        mode: "paused",
        pauseCode: runtimeState.risk.pauseCode,
        pauseReason: runtimeState.risk.pauseReason,
        risk: summarizeRisk(runtimeState),
        autoRedeem: summarizeRedemption(autoRedeemResult),
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }
  if (
    !cli.force &&
    runtimeState.run.lastProcessedCandleOpenTimeMs !== null &&
    runtimeState.run.lastProcessedCandleOpenTimeMs === latestClosedCandle.openTimeMs &&
    !isPendingDecisionRetry(runtimeState, latestClosedCandle)
  ) {
    return emitResult(
      {
        mode: "noop_already_processed",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        stateFile: config.stateFile,
      },
      printOutput,
    );
  }

  let reconciliation: ExecutionReconciliation | null = null;
  let session = null;
  let client = null;
  if (canReconcilePreviousOrder(runtimeState, latestClosedCandle)) {
    session = await resolveSessionContext(config);
    client = createTradingClient(config, session);
    reconciliation = await reconcileExecutionForOrder({
      client,
      config,
      session,
      orderId: runtimeState.orders.lastOrderId,
      preferredTokenId: runtimeState.orders.lastOrderTokenId || undefined,
    });
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "EXECUTION_RECONCILED",
      message: "Reconciled previous hourly order before advancing daemon state.",
      orderId: runtimeState.orders.lastOrderId,
      tokenId: reconciliation.tokenId,
      payload: summarizeReconciliation(reconciliation),
    });
    if (reconciliation.inferredStatus === "OPEN") {
      const staleOrderId = runtimeState.orders.lastOrderId;
      try {
        const cancelResult = await cancelOrder(client, staleOrderId);
        appendExecutionEvent(config.eventsLogFile, {
          timestamp: nowIso(),
          eventType: "STALE_ORDER_CANCEL_REQUESTED",
          message: "Canceled stale open order from previous martingale step before advancing daemon state.",
          orderId: staleOrderId,
          tokenId: reconciliation.tokenId,
          payload: cancelResult,
        });
        reconciliation = await reconcileExecutionForOrder({
          client,
          config,
          session,
          orderId: staleOrderId,
          preferredTokenId: runtimeState.orders.lastOrderTokenId || undefined,
        });
      } catch (error) {
        appendExecutionEvent(config.eventsLogFile, {
          timestamp: nowIso(),
          eventType: "STALE_ORDER_CANCEL_FAILED",
          message: error instanceof Error ? error.message : String(error),
          orderId: staleOrderId,
          tokenId: reconciliation.tokenId,
        });
      }
    }
  }

  const resolvedStepBeforeOutcome = runtimeState.run.currentStep;
  const previousResolution = resolvePreviousOutcome({
    state: runtimeState,
    latestClosedCandle,
    reconciliation,
  });
  const previousOutcome = previousResolution.outcome;
  if (previousResolution.shouldPause) {
    runtimeState = pauseRuntimeState(
      runtimeState,
      "AWAITING_RECONCILIATION",
      previousResolution.pauseReason,
      "PAUSED_FOR_RECONCILIATION",
    );
    if (cli.commitState || cli.execute) {
      saveRuntimeState(config.stateFile, runtimeState);
    }
    return emitResult(
      {
        mode: "awaiting_reconciliation",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        currentState,
        reconciliation: summarizeReconciliation(reconciliation),
        pauseReason: previousResolution.pauseReason,
        risk: summarizeRisk(runtimeState),
        nextRunState: runtimeState.run,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }
  if (previousResolution.shouldAbortRun) {
    runtimeState = applyRunState(
      runtimeState,
      abortRunAfterMissedEntry({
        state: runtimeState,
        latestClosedCandle,
        currentState,
        reason: previousResolution.abortReason,
      }),
    );
    runtimeState = resumeRuntimeState(
      runtimeState,
      previousResolution.abortReason,
      "ENTRY_MISSED_ABORT_RUN",
    );
    if (cli.commitState || cli.execute) {
      saveRuntimeState(config.stateFile, runtimeState);
    }
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "ENTRY_MISSED_ABORT_RUN",
      message: previousResolution.abortReason,
      orderId: runtimeState.orders.lastOrderId || undefined,
      tokenId: runtimeState.orders.lastOrderTokenId || undefined,
      payload: {
        reconciliation: summarizeReconciliation(reconciliation),
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
      },
    });
    return emitResult(
      {
        mode: "entry_missed_abort_run",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        currentState,
        reconciliation: summarizeReconciliation(reconciliation),
        reason: previousResolution.abortReason,
        risk: summarizeRisk(runtimeState),
        nextRunState: runtimeState.run,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }

  const progressedRun = applyPreviousOutcome(runtimeState, previousOutcome, strategy);
  runtimeState = applyRunState(runtimeState, progressedRun);
  runtimeState = applyOutcomeToRisk({
    state: runtimeState,
    strategy,
    outcome: previousOutcome,
    resolvedStep: resolvedStepBeforeOutcome,
    blewUp: previousOutcome === "loss" && resolvedStepBeforeOutcome === strategy.maxSteps,
  });
  const riskDecision = evaluateRiskLimits(runtimeState, config);
  if (riskDecision.shouldPause) {
    runtimeState = pauseRuntimeState(runtimeState, riskDecision.pauseCode, riskDecision.pauseReason, "RISK_LIMIT_HIT");
    if (cli.commitState || cli.execute) {
      saveRuntimeState(config.stateFile, runtimeState);
    }
    return emitResult(
      {
        mode: "risk_paused",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        previousOutcome,
        reconciliation: summarizeReconciliation(reconciliation),
        risk: summarizeRisk(runtimeState),
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }
  runtimeState = resumeRuntimeState(runtimeState, "Risk checks passed for current daemon tick.", "RISK_CHECK_CLEAR");
  runtimeState = applyRiskState(runtimeState, runtimeState.risk);

  if (cli.execute && previousOutcome === "win") {
    if (!session) {
      session = await resolveSessionContext(config);
    }
    autoRedeemResult = await attemptAutoRedeemWinningPosition({
      config,
      session,
      state: runtimeState,
    }).catch((error) => ({
      status: "failed" as const,
      reason: error instanceof Error ? error.message : String(error),
      tokenId: runtimeState.orders.lastOrderTokenId,
      conditionId: runtimeState.redemption.lastAttemptedConditionId,
      marketStartTime: runtimeState.redemption.lastAttemptedMarketStartTime,
    }));
    runtimeState = applyAutoRedeemResult(runtimeState, autoRedeemResult);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "AUTO_REDEEM_STATUS",
      message: autoRedeemResult.reason,
      tokenId: autoRedeemResult.tokenId || undefined,
      payload: summarizeRedemption(autoRedeemResult),
    });
  }

  const decision = evaluateStrategyDecision({
    currentState,
    strategy,
    allowedStates,
    currentStep: runtimeState.run.inRun ? runtimeState.run.currentStep : null,
  });
  const targetMarketTime = resolveTargetMarketTime(targetTime);
  const market =
    decision.recommendedAction === "BLOCK"
      ? null
      : await locateCurrentBtc1hMarket(config, {
          targetTime: targetMarketTime,
          requireExactStart: true,
        });
  const selectedOutcome =
    decision.nextDirection === "U" ? "Up" : decision.nextDirection === "D" ? "Down" : null;
  const selectedToken = selectedOutcome
    ? market?.outcomes.find((outcome) => outcome.outcome.toLowerCase() === selectedOutcome.toLowerCase()) ?? null
    : null;
  const marketNotReadyReason =
    decision.recommendedAction === "BLOCK"
      ? null
      : getMarketNotReadyReason({
          market,
          selectedOutcome,
          selectedToken,
          targetMarketTime,
        });

  if (marketNotReadyReason) {
    runtimeState = applyRunState(
      runtimeState,
      buildPendingMarketRetryRunState({
        state: runtimeState,
        latestClosedCandle,
        currentState,
        decision,
        reason: marketNotReadyReason,
      }),
    );
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "MARKET_NOT_READY_RETRY",
      message: marketNotReadyReason,
      tokenId: selectedToken?.tokenId,
      payload: {
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        targetMarketTime: targetMarketTime.toISOString(),
        market: summarizeMarket(market),
        selectedOutcome,
      },
    });
    if (cli.commitState || cli.execute) {
      saveRuntimeState(config.stateFile, runtimeState);
    }
    return emitResult(
      {
        mode: "market_not_ready_retry",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        targetMarketTime: targetMarketTime.toISOString(),
        previousOutcome,
        currentState,
        decision,
        market: summarizeMarket(market),
        selectedOutcome,
        retryReason: marketNotReadyReason,
        nextRunState: runtimeState.run,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }

  const nextRunState = buildNextRunState({
    state: runtimeState,
    latestClosedCandle,
    currentState,
    decision,
  });
  let orderIntent = buildOrderIntent({
    baseStakeU: strategy.baseStakeU,
    step: decision.nextStep,
    selectedToken,
    orderType: cli.orderType,
    overridePrice: cli.price,
  });

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: nowIso(),
    eventType: "DAEMON_TICK_READY",
    message: "Prepared hourly daemon tick.",
    tokenId: selectedToken?.tokenId,
    payload: {
      latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
      targetMarketTime: targetMarketTime.toISOString(),
      previousOutcome,
      reconciliation: summarizeReconciliation(reconciliation),
          autoRedeem: summarizeRedemption(autoRedeemResult),
      currentState,
      decision,
      selectedOutcome,
      selectedToken,
      orderIntent,
      nextRunState,
    },
  });

  if (!cli.execute) {
    if (cli.commitState) {
      saveRuntimeState(config.stateFile, applyRunState(runtimeState, nextRunState));
    }
    return emitResult(
      {
        mode: cli.commitState ? "dry_run_committed" : "dry_run",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        targetMarketTime: targetMarketTime.toISOString(),
        previousOutcome,
        reconciliation: summarizeReconciliation(reconciliation),
        risk: summarizeRisk(runtimeState),
        autoRedeem: summarizeRedemption(autoRedeemResult),
        strategyVersion: strategy.version,
        currentState,
        decision,
        market: summarizeMarket(market),
        selectedOutcome,
        selectedToken,
        orderIntent,
        nextRunState,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }

  if (decision.recommendedAction === "BLOCK") {
    runtimeState = applyRunState(runtimeState, nextRunState);
    saveRuntimeState(config.stateFile, runtimeState);
    return emitResult(
      {
        mode: "execute_blocked",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        targetMarketTime: targetMarketTime.toISOString(),
        previousOutcome,
        currentState,
        decision,
        autoRedeem: summarizeRedemption(autoRedeemResult),
        nextRunState: runtimeState.run,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  }

  if (!orderIntent) {
    throw new Error("Order intent could not be built");
  }

  try {
    if (!session || !client) {
      session = await resolveSessionContext(config);
      client = createTradingClient(config, session);
    }
    runtimeState = applySessionSnapshot(runtimeState, session);
    const accountSnapshot = await getCollateralSnapshot(client, session);
    runtimeState = applyAccountSnapshot(runtimeState, accountSnapshot);

    appendExecutionEvent(config.eventsLogFile, {
      timestamp: accountSnapshot.timestamp,
      eventType: "BALANCE_SNAPSHOT",
      message: "Fetched balance before hourly daemon execution.",
      payload: accountSnapshot,
    });

    if ((orderIntent.orderType === "FOK" || orderIntent.orderType === "FAK") && !cli.price) {
      const marketPrice = await client.calculateMarketPrice(orderIntent.tokenId, Side.BUY, orderIntent.amount);
      orderIntent = {
        ...orderIntent,
        price: Number(marketPrice.toFixed(6)),
        size: computeOrderSize(orderIntent.amount, marketPrice),
      };
    }

    const postResult = (await postLimitOrder(client, orderIntent)) as Record<string, unknown>;
    const orderId = String(postResult.orderID ?? "");

    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "DAEMON_ORDER_POSTED",
      message: "Submitted live order from hourly daemon demo.",
      orderId,
      tokenId: orderIntent.tokenId,
      payload: {
        orderIntent,
        postResult,
      },
    });

    let orderSnapshot = orderId ? await getOrderSnapshot(client, orderId) : null;
    if (orderSnapshot) {
      runtimeState = applyOrderSnapshot(runtimeState, orderSnapshot);
    }

    if (orderSnapshot && isOpenOrderStatus(orderSnapshot.status)) {
      try {
        const cancelResult = await cancelOrder(client, orderId);
        appendExecutionEvent(config.eventsLogFile, {
          timestamp: nowIso(),
          eventType: "ENTRY_ORDER_CANCELLED",
          message: "Canceled unexpectedly resting entry order to avoid stale martingale state.",
          orderId,
          tokenId: orderIntent.tokenId,
          payload: cancelResult,
        });
        orderSnapshot = await getOrderSnapshot(client, orderId);
        runtimeState = applyOrderSnapshot(runtimeState, orderSnapshot);
      } catch (error) {
        appendExecutionEvent(config.eventsLogFile, {
          timestamp: nowIso(),
          eventType: "ENTRY_ORDER_CANCEL_FAILED",
          message: error instanceof Error ? error.message : String(error),
          orderId,
          tokenId: orderIntent.tokenId,
        });
      }
    }

    if (!orderId || (orderSnapshot && !isOpenOrderStatus(orderSnapshot.status) && !isAcceptedEntryStatus(orderSnapshot.status))) {
      const missedReason = !orderId
        ? "本小时订单未生成可跟踪的 orderId，视为未成交并中止本轮。"
        : `本小时订单未形成可持续持有的入场结果（status=${orderSnapshot?.status || "unknown"}），本轮中止。`;
      runtimeState = applyRunState(
        runtimeState,
        abortRunAfterMissedEntry({
          state: runtimeState,
          latestClosedCandle,
          currentState,
          reason: missedReason,
        }),
      );
      runtimeState = clearApiFailureCounter(runtimeState);
      saveRuntimeState(config.stateFile, runtimeState);
      appendExecutionEvent(config.eventsLogFile, {
        timestamp: nowIso(),
        eventType: "ENTRY_MISSED_ABORT_RUN",
        message: missedReason,
        orderId: orderId || undefined,
        tokenId: orderIntent.tokenId,
        payload: {
          orderIntent,
          postResult,
          orderSnapshot,
        },
      });
      return emitResult(
        {
          mode: "execute_entry_missed",
          latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
          targetMarketTime: targetMarketTime.toISOString(),
          previousOutcome,
          reconciliation: summarizeReconciliation(reconciliation),
          risk: summarizeRisk(runtimeState),
          autoRedeem: summarizeRedemption(autoRedeemResult),
          strategyVersion: strategy.version,
          currentState,
          decision,
          market: summarizeMarket(market),
          selectedOutcome,
          selectedToken,
          orderIntent,
          orderId,
          reason: missedReason,
          nextRunState: runtimeState.run,
          stateFile: config.stateFile,
          eventsLog: config.eventsLogFile,
        },
        printOutput,
      );
    }

    runtimeState = applyRunState(runtimeState, nextRunState);
    runtimeState = clearApiFailureCounter(runtimeState);

    saveRuntimeState(config.stateFile, runtimeState);

    return emitResult(
      {
        mode: "execute",
        latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
        targetMarketTime: targetMarketTime.toISOString(),
        previousOutcome,
        reconciliation: summarizeReconciliation(reconciliation),
        risk: summarizeRisk(runtimeState),
        autoRedeem: summarizeRedemption(autoRedeemResult),
        strategyVersion: strategy.version,
        currentState,
        decision,
        market: summarizeMarket(market),
        selectedOutcome,
        selectedToken,
        orderIntent,
        orderId,
        nextRunState: runtimeState.run,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      printOutput,
    );
  } catch (error) {
    if (isMissedEntryError(error)) {
      const reason = "本小时订单未能立即成交，已按未成交处理并中止本轮。";
      runtimeState = applyRunState(
        runtimeState,
        abortRunAfterMissedEntry({
          state: runtimeState,
          latestClosedCandle,
          currentState,
          reason,
        }),
      );
      runtimeState = clearApiFailureCounter(runtimeState);
      saveRuntimeState(config.stateFile, runtimeState);
      appendExecutionEvent(config.eventsLogFile, {
        timestamp: nowIso(),
        eventType: "ENTRY_MISSED_ABORT_RUN",
        message: reason,
        tokenId: orderIntent.tokenId,
        payload: {
          orderIntent,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return emitResult(
        {
          mode: "execute_entry_missed",
          latestClosedCandleOpenTimeMs: latestClosedCandle.openTimeMs,
          targetMarketTime: targetMarketTime.toISOString(),
          previousOutcome,
          reconciliation: summarizeReconciliation(reconciliation),
          risk: summarizeRisk(runtimeState),
          autoRedeem: summarizeRedemption(autoRedeemResult),
          strategyVersion: strategy.version,
          currentState,
          decision,
          market: summarizeMarket(market),
          selectedOutcome,
          selectedToken,
          orderIntent,
          reason,
          nextRunState: runtimeState.run,
          stateFile: config.stateFile,
          eventsLog: config.eventsLogFile,
        },
        printOutput,
      );
    }
    runtimeState = registerApiFailure(runtimeState, error instanceof Error ? error.message : "unknown_error");
    const apiRiskDecision = evaluateRiskLimits(runtimeState, config);
    if (apiRiskDecision.shouldPause) {
      runtimeState = pauseRuntimeState(runtimeState, apiRiskDecision.pauseCode, apiRiskDecision.pauseReason, "API_FAILURE_PAUSE");
    }
    saveRuntimeState(config.stateFile, runtimeState);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: nowIso(),
      eventType: "DAEMON_EXECUTION_ERROR",
      message: "Hourly daemon execution failed.",
      payload: {
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        risk: summarizeRisk(runtimeState),
      },
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHourlyDaemon({ printOutput: true }).catch((error) => {
    console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
