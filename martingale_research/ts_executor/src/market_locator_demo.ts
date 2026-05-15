import { loadExecutorConfig } from "./config.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";

interface CliArgs {
  at?: string;
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
  console.log("  npm run market-locator --");
  console.log("  npm run market-locator -- --at 2026-05-13T12:00:00Z");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const targetTime = cli.at ? new Date(cli.at) : new Date();
  if (Number.isNaN(targetTime.getTime())) {
    throw new Error(`Invalid --at value: ${cli.at}`);
  }

  const config = loadExecutorConfig();
  const market = await locateCurrentBtc1hMarket(config, { targetTime });
  if (!market) {
    console.log("market_locator");
    console.log(
      JSON.stringify(
        {
          targetTime: targetTime.toISOString(),
          found: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("market_locator");
  console.log(
    JSON.stringify(
      {
        targetTime: targetTime.toISOString(),
        found: true,
        marketId: market.marketId,
        slug: market.slug,
        question: market.question,
        eventSlug: market.eventSlug,
        eventTitle: market.eventTitle,
        seriesSlug: market.seriesSlug,
        eventStartTime: market.eventStartTime,
        endDate: market.endDate,
        tickSize: market.tickSize,
        orderMinSize: market.orderMinSize,
        negRisk: market.negRisk,
        outcomes: market.outcomes,
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
