import { getCollateralSnapshot } from "./account.js";
import { fetchRecentClosedBinance1hCandles, recentStateString } from "./binance_state.js";
import { resolveSessionContext } from "./auth.js";
import { createTradingClient } from "./client.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { getOrderSnapshot, postLimitOrder } from "./orders.js";
import {
  applyAccountSnapshot,
  applyOrderSnapshot,
  applySessionSnapshot,
  loadRuntimeState,
  saveRuntimeState,
} from "./state.js";
import { evaluateStrategyDecision } from "./state_gate.js";
import { loadStrategyBundle } from "./strategy_loader.js";
import type { OrderIntent, RuntimeStateV2 } from "./types.js";

interface CliArgs {
  at?: string;
  step?: number;
  execute: boolean;
  help: boolean;
  orderType: "GTC" | "GTD";
  price?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    execute: false,
    help: false,
    orderType: "GTC",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--at":
        out.at = next;
        i += 1;
        break;
      case "--step":
        out.step = Number(next);
        i += 1;
        break;
      case "--price":
        out.price = Number(next);
        i += 1;
        break;
      case "--order-type":
        if (next === "GTD" || next === "GTC") {
          out.orderType = next;
        }
        i += 1;
        break;
      case "--execute":
        out.execute = true;
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
  console.log("  npm run auto-trade --");
  console.log("  npm run auto-trade -- --step 2");
  console.log("  npm run auto-trade -- --execute --price 0.99");
  console.log("");
  console.log("Notes:");
  console.log("  - Default mode is dry-run and will not place a live order.");
  console.log("  - Add --execute to actually submit an order.");
  console.log("  - --price overrides the market-derived price used for limit order sizing.");
}

function nowIso(): string {
  return new Date().toISOString();
}

function updateStrategyState(
  state: RuntimeStateV2,
  strategyVersion: string,
  decisionAction: string,
  nextStep: number | null,
): RuntimeStateV2 {
  return {
    ...state,
    strategy: {
      strategyVersion,
      mode: "phase_d_auto_trade",
    },
    run: {
      inRun: decisionAction === "START_RUN" || decisionAction.startsWith("BET_STEP_"),
      currentStep: nextStep,
      lastProcessedCandleOpenTimeMs: state.run.lastProcessedCandleOpenTimeMs,
      pendingDecisionCandleOpenTimeMs: state.run.pendingDecisionCandleOpenTimeMs,
      lastState: state.run.lastState,
      lastAction: decisionAction,
      lastDirection: null,
      lastReason: "",
      pendingDecisionReason: state.run.pendingDecisionReason,
      pauseReason: "",
      updatedAt: nowIso(),
      totalRunsStarted: state.run.totalRunsStarted,
      totalWins: state.run.totalWins,
      totalLosses: state.run.totalLosses,
      totalBlowups: state.run.totalBlowups,
    },
  };
}

function computeTargetNotional(baseStakeU: number, step: number): number {
  return Number((baseStakeU * 2 ** (step - 1)).toFixed(6));
}

function computeOrderSize(targetNotional: number, price: number): number {
  if (!(price > 0)) {
    throw new Error(`Order price must be positive, got ${price}`);
  }
  return Number((targetNotional / price).toFixed(6));
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

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const config = loadExecutorConfig();
  const { strategy, allowedStates } = loadStrategyBundle(config.strategyDir, {
    baseStakeUOverride: config.baseStakeU,
  });
  const candles = await fetchRecentClosedBinance1hCandles(config, 6);
  const currentState = recentStateString(candles, 6);
  const decision = evaluateStrategyDecision({
    currentState,
    strategy,
    allowedStates,
    currentStep: cli.step ?? null,
  });

  const targetTime = cli.at ? new Date(cli.at) : new Date();
  if (Number.isNaN(targetTime.getTime())) {
    throw new Error(`Invalid --at value: ${cli.at}`);
  }

  const market = await locateCurrentBtc1hMarket(config, { targetTime });
  const selectedOutcome =
    decision.nextDirection === "U" ? "Up" : decision.nextDirection === "D" ? "Down" : null;
  const selectedToken = selectedOutcome
    ? market?.outcomes.find((outcome) => outcome.outcome.toLowerCase() === selectedOutcome.toLowerCase()) ?? null
    : null;

  const effectiveStep = decision.nextStep ?? cli.step ?? null;
  const targetNotional = effectiveStep !== null ? computeTargetNotional(strategy.baseStakeU, effectiveStep) : null;
  const limitPrice = cli.price ?? (selectedToken ? Number(selectedToken.price) : null);
  const orderIntent: OrderIntent | null =
    selectedToken && effectiveStep !== null && targetNotional !== null && limitPrice !== null && limitPrice > 0
      ? {
          tokenId: selectedToken.tokenId,
          side: "BUY",
          price: limitPrice,
          size: computeOrderSize(targetNotional, limitPrice),
          amount: targetNotional,
          orderType: cli.orderType,
        }
      : null;

  let runtimeState = updateStrategyState(
    loadRuntimeState(config.stateFile),
    strategy.version,
    decision.recommendedAction,
    decision.nextStep,
  );
  runtimeState = {
    ...runtimeState,
    run: {
      ...runtimeState.run,
      lastState: currentState,
      lastDirection: decision.nextDirection,
      lastReason: decision.reason,
      totalRunsStarted:
        decision.recommendedAction === "START_RUN"
          ? runtimeState.run.totalRunsStarted + 1
          : runtimeState.run.totalRunsStarted,
    },
  };

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: nowIso(),
    eventType: "DECISION_READY",
    message: "Prepared automatic trading decision.",
    tokenId: selectedToken?.tokenId,
    payload: {
      currentState,
      decision,
      selectedOutcome,
      selectedToken,
      targetNotional,
      orderIntent,
    },
  });

  if (!cli.execute) {
    saveRuntimeState(config.stateFile, runtimeState);
    console.log(
      JSON.stringify(
        {
          mode: "dry_run",
          strategyVersion: strategy.version,
          currentState,
          decision,
          market: summarizeMarket(market),
          selectedOutcome,
          selectedToken,
          targetNotional,
          orderIntent,
          stateFile: config.stateFile,
          eventsLog: config.eventsLogFile,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (decision.recommendedAction === "BLOCK") {
    throw new Error("Decision is BLOCK; refusing to place an order");
  }
  if (!orderIntent) {
    throw new Error("Order intent could not be built");
  }

  const session = await resolveSessionContext(config);
  runtimeState = applySessionSnapshot(runtimeState, session);
  const client = createTradingClient(config, session);
  const accountSnapshot = await getCollateralSnapshot(client, session);
  runtimeState = applyAccountSnapshot(runtimeState, accountSnapshot);

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: accountSnapshot.timestamp,
    eventType: "BALANCE_SNAPSHOT",
    message: "Fetched balance before auto trade execution.",
    payload: accountSnapshot,
  });

  const postResult = (await postLimitOrder(client, orderIntent)) as Record<string, unknown>;
  const orderId = String(postResult.orderID ?? "");

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: nowIso(),
    eventType: "AUTO_TRADE_POSTED",
    message: "Submitted live order from auto trade demo.",
    orderId,
    tokenId: orderIntent.tokenId,
    payload: {
      orderIntent,
      postResult,
    },
  });

  if (orderId) {
    const orderSnapshot = await getOrderSnapshot(client, orderId);
    runtimeState = applyOrderSnapshot(runtimeState, orderSnapshot);
  }

  saveRuntimeState(config.stateFile, runtimeState);

  console.log(
    JSON.stringify(
      {
        mode: "execute",
        strategyVersion: strategy.version,
        currentState,
        decision,
        market: summarizeMarket(market),
        selectedOutcome,
        selectedToken,
        targetNotional,
        orderIntent,
        orderId,
        stateFile: config.stateFile,
        eventsLog: config.eventsLogFile,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
