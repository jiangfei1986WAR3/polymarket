import { getCollateralSnapshot } from "./account.js";
import { resolveSessionContext } from "./auth.js";
import { createTradingClient } from "./client.js";
import { loadExecutorConfig } from "./config.js";
import { appendExecutionEvent } from "./logger.js";
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
import { getTradesForOrder } from "./trades.js";

interface CliArgs {
  orderId?: string;
  tokenId?: string;
  price?: number;
  size?: number;
  side: "BUY" | "SELL";
  orderType: "GTC" | "FOK" | "FAK" | "GTD";
  cancel: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    side: "BUY",
    orderType: "GTC",
    cancel: false,
    help: false,
  };

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
      case "--price":
        out.price = Number(next);
        i += 1;
        break;
      case "--size":
        out.size = Number(next);
        i += 1;
        break;
      case "--side":
        out.side = next === "SELL" ? "SELL" : "BUY";
        i += 1;
        break;
      case "--order-type":
        if (next === "FOK" || next === "FAK" || next === "GTD" || next === "GTC") {
          out.orderType = next;
        }
        i += 1;
        break;
      case "--cancel":
        out.cancel = true;
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
  console.log("  npm run lifecycle-demo -- --order-id <ORDER_ID>");
  console.log("  npm run lifecycle-demo -- --token-id <TOKEN_ID> --price <PRICE> --size <SIZE> [--side BUY|SELL] [--order-type GTC|FOK|FAK|GTD] [--cancel]");
  console.log("");
  console.log("Modes:");
  console.log("  1. order-id mode   -> Query existing order, trades, positions.");
  console.log("  2. token-id mode   -> Submit a test order, then query lifecycle.");
  console.log("  3. no args mode    -> Only verify session and balance snapshot.");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }
  if (!cli.orderId && ((cli.tokenId && (!cli.price || !cli.size)) || (!cli.tokenId && (cli.price || cli.size)))) {
    throw new Error("token-id mode requires --token-id, --price and --size together");
  }
  const config = loadExecutorConfig();
  const state = loadRuntimeState(config.stateFile);

  const session = await resolveSessionContext(config);
  appendExecutionEvent(config.eventsLogFile, {
    timestamp: new Date().toISOString(),
    eventType: "SESSION_READY",
    message: "Session context resolved successfully.",
    payload: {
      walletAddress: session.walletAddress,
      funderAddress: session.funderAddress,
      signatureType: session.signatureType,
    },
  });

  const nextState = applySessionSnapshot(state, session);
  saveRuntimeState(config.stateFile, nextState);

  const client = createTradingClient(config, session);
  const snapshot = await getCollateralSnapshot(client, session);

  appendExecutionEvent(config.eventsLogFile, {
    timestamp: snapshot.timestamp,
    eventType: "BALANCE_SNAPSHOT",
    message: "Fetched collateral balance and allowance.",
    payload: snapshot,
  });

  saveRuntimeState(config.stateFile, applyAccountSnapshot(nextState, snapshot));

  let latestState = applyAccountSnapshot(nextState, snapshot);
  let inspectedOrderId = cli.orderId;

  if (!inspectedOrderId && cli.tokenId && cli.price && cli.size) {
    const postResult = (await postLimitOrder(client, {
      tokenId: cli.tokenId,
      side: cli.side,
      price: cli.price,
      size: cli.size,
      amount: cli.side === "BUY" ? Number((cli.price * cli.size).toFixed(6)) : cli.size,
      orderType: cli.orderType,
    })) as Record<string, unknown>;
    inspectedOrderId = String(postResult.orderID ?? "");
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: new Date().toISOString(),
      eventType: "ORDER_POSTED",
      message: "Submitted test order from lifecycle demo.",
      orderId: inspectedOrderId,
      tokenId: cli.tokenId,
      payload: postResult,
    });
  }

  if (inspectedOrderId) {
    const orderSnapshot = await getOrderSnapshot(client, inspectedOrderId);
    latestState = applyOrderSnapshot(latestState, orderSnapshot);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: new Date().toISOString(),
      eventType: "ORDER_STATUS_UPDATED",
      message: "Fetched order snapshot.",
      orderId: orderSnapshot.orderId,
      tokenId: orderSnapshot.tokenId,
      payload: orderSnapshot,
    });

    const tradeSnapshot = await getTradesForOrder(client, inspectedOrderId, session.funderAddress);
    latestState = applyTradeSnapshot(latestState, tradeSnapshot);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: new Date().toISOString(),
      eventType: "TRADES_FETCHED",
      message: "Fetched trades for order.",
      orderId: inspectedOrderId,
      payload: tradeSnapshot,
    });

    const positionSnapshot = await getPositionsSnapshot(config, session, orderSnapshot.tokenId);
    latestState = applyPositionSnapshot(latestState, positionSnapshot);
    appendExecutionEvent(config.eventsLogFile, {
      timestamp: new Date().toISOString(),
      eventType: "POSITION_SNAPSHOT",
      message: "Fetched positions snapshot.",
      orderId: inspectedOrderId,
      tokenId: orderSnapshot.tokenId,
      payload: positionSnapshot,
    });

    if (cli.cancel && orderSnapshot.status.toLowerCase() !== "matched") {
      const cancelResult = await cancelOrder(client, inspectedOrderId);
      appendExecutionEvent(config.eventsLogFile, {
        timestamp: new Date().toISOString(),
        eventType: "ORDER_CANCELLED",
        message: "Cancelled order from lifecycle demo.",
        orderId: inspectedOrderId,
        payload: cancelResult,
      });
    }
  }

  saveRuntimeState(config.stateFile, latestState);

  console.log("session");
  console.log(
    JSON.stringify(
      {
        walletAddress: session.walletAddress,
        funderAddress: session.funderAddress,
        signatureType: session.signatureType,
        apiCredsPresent: Boolean(session.creds.key && session.creds.secret && session.creds.passphrase),
      },
      null,
      2,
    ),
  );
  console.log("account_snapshot");
  console.log(JSON.stringify(snapshot, null, 2));
  console.log("order_id", inspectedOrderId ?? "");
  console.log("mode", inspectedOrderId ? "order_lifecycle" : "balance_only");
  console.log("state_file", config.stateFile);
  console.log("events_log", config.eventsLogFile);
}

main().catch((error) => {
  console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
