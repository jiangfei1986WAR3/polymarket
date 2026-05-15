import { resolveSessionContext } from "./auth.js";
import { createTradingClient } from "./client.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
import { reconcileExecutionForOrder } from "./execution_reconciler.js";
import { loadRuntimeState } from "./state.js";

interface CliArgs {
  orderId?: string;
  tokenId?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--order-id":
        out.orderId = next;
        i += 1;
        break;
      case "--token-id":
        out.tokenId = next;
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
  console.log("  npm run reconciler -- --order-id <ORDER_ID>");
  console.log("  npm run reconciler -- --order-id <ORDER_ID> --token-id <TOKEN_ID>");
  console.log("  npm run reconciler --");
  console.log("");
  console.log("Notes:");
  console.log("  - If no --order-id is provided, the script will use runtime_state.lastOrderId.");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const config = loadExecutorConfig();
  const runtimeState = loadRuntimeState(config.stateFile);
  const orderId = cli.orderId ?? runtimeState.orders.lastOrderId;
  const preferredTokenId = cli.tokenId ?? runtimeState.orders.lastOrderTokenId;

  if (!orderId) {
    throw new Error("Missing order id. Provide --order-id or ensure runtime_state has lastOrderId.");
  }

  const session = await resolveSessionContext(config);
  const client = createTradingClient(config, session);
  const reconciliation = await reconcileExecutionForOrder({
    client,
    config,
    session,
    orderId,
    preferredTokenId: preferredTokenId || undefined,
  });

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: new Date().toISOString(),
    eventType: "EXECUTION_RECONCILED",
    message: "Reconciled execution status from order/trades/positions.",
    orderId,
    tokenId: reconciliation.tokenId,
    payload: reconciliation,
  });

  console.log(
    JSON.stringify(
      {
        orderId: reconciliation.orderId,
        tokenId: reconciliation.tokenId,
        orderStatus: reconciliation.orderStatus,
        orderFound: reconciliation.orderFound,
        tradeCount: reconciliation.tradeCount,
        tradeIds: reconciliation.tradeIds,
        tradeTokenIds: reconciliation.tradeTokenIds,
        latestTradePrice: reconciliation.latestTradePrice,
        latestTradeSide: reconciliation.latestTradeSide,
        latestTradeStatus: reconciliation.latestTradeStatus,
        positionFound: reconciliation.positionFound,
        positionSize: reconciliation.positionSize,
        positionSide: reconciliation.positionSide,
        positionEntryPrice: reconciliation.positionEntryPrice,
        inferredStatus: reconciliation.inferredStatus,
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
