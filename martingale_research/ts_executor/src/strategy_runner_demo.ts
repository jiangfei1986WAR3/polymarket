import { fetchRecentClosedBinance1hCandles, recentStateString } from "./binance_state.js";
import { loadExecutorConfig } from "./config.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { evaluateStrategyDecision } from "./state_gate.js";
import { loadStrategyBundle } from "./strategy_loader.js";

interface CliArgs {
  at?: string;
  step?: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
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
  console.log("  npm run strategy-runner --");
  console.log("  npm run strategy-runner -- --step 2");
  console.log("  npm run strategy-runner -- --at 2026-05-13T15:00:00Z");
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

  console.log("strategy_runner");
  console.log(
    JSON.stringify(
      {
        strategyVersion: strategy.version,
        pattern: strategy.pattern,
        baseStakeU: strategy.baseStakeU,
        maxSteps: strategy.maxSteps,
        allowedStatesCount: allowedStates.allowedStates.size,
        currentState,
        currentStep: cli.step ?? null,
        decision,
        market:
          market === null
            ? null
            : {
                marketId: market.marketId,
                slug: market.slug,
                eventTitle: market.eventTitle,
                eventStartTime: market.eventStartTime,
                outcomes: market.outcomes,
              },
        selectedOutcome,
        selectedToken,
        latestCandleOpenTimeMs: candles[candles.length - 1]?.openTimeMs ?? null,
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
