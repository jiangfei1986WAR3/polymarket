import type { ClobClient } from "@polymarket/clob-client-v2";

import { getOrderSnapshot } from "./orders.js";
import { getPositionsSnapshot } from "./positions.js";
import { getTradesForOrder } from "./trades.js";
import type { ExecutionReconciliation, ExecutorConfig, SessionContext } from "./types.js";

function inferStatus(args: {
  orderStatus: string;
  tradeCount: number;
  positionSize: number;
}): ExecutionReconciliation["inferredStatus"] {
  const orderStatus = args.orderStatus.toUpperCase();
  if (orderStatus === "LIVE" || orderStatus === "OPEN") {
    return "OPEN";
  }
  if (orderStatus === "CANCELED" || orderStatus === "CANCELLED" || orderStatus === "UNMATCHED" || orderStatus === "EXPIRED") {
    return "MISSED";
  }
  if (orderStatus === "MATCHED" || orderStatus === "MINED" || orderStatus === "CONFIRMED") {
    return "MATCHED";
  }
  if (args.positionSize > 0) {
    return "FILLED_POSITION";
  }
  if (args.tradeCount > 0) {
    return "MATCHED";
  }
  if (orderStatus === "NOT_FOUND") {
    return "NO_EVIDENCE";
  }
  return "UNKNOWN";
}

export async function reconcileExecutionForOrder(args: {
  client: ClobClient;
  config: ExecutorConfig;
  session: SessionContext;
  orderId: string;
  preferredTokenId?: string;
}): Promise<ExecutionReconciliation> {
  const { client, config, session, orderId, preferredTokenId } = args;
  const order = await getOrderSnapshot(client, orderId);
  const trades = await getTradesForOrder(client, orderId, session.funderAddress);
  const resolvedTokenId =
    preferredTokenId?.trim() || order.tokenId || trades.tokenIds.find((tokenId) => tokenId.trim()) || "";
  const position = await getPositionsSnapshot(config, session, resolvedTokenId || undefined);

  return {
    orderId,
    tokenId: resolvedTokenId,
    orderStatus: order.status,
    orderFound: order.status !== "NOT_FOUND",
    tradeCount: trades.count,
    tradeIds: trades.tradeIds,
    tradeTokenIds: trades.tokenIds,
    latestTradePrice: trades.latestPrice,
    latestTradeSide: trades.latestSide,
    latestTradeStatus: trades.latestStatus,
    positionFound: position.size > 0,
    positionSize: position.size,
    positionSide: position.side,
    positionEntryPrice: position.entryPrice,
    inferredStatus: inferStatus({
      orderStatus: order.status,
      tradeCount: trades.count,
      positionSize: position.size,
    }),
    raw: {
      order: order.raw,
      trades: trades.raw,
      position: position.raw,
    },
  };
}
