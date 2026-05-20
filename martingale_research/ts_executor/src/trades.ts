import type { ClobClient } from "@polymarket/clob-client-v2";

import type { TradeSnapshot } from "./types.js";

function matchesOrderId(
  trade: Awaited<ReturnType<ClobClient["getTrades"]>>[number],
  orderId: string,
): boolean {
  return (
    trade.taker_order_id === orderId ||
    trade.maker_orders.some((makerOrder) => makerOrder.order_id === orderId)
  );
}

export async function getTradesForOrder(
  client: ClobClient,
  orderId: string,
  makerAddress?: string,
): Promise<TradeSnapshot> {
  const makerScopedTrades = makerAddress ? await client.getTrades({ maker_address: makerAddress }) : null;
  let matchedTrades = (makerScopedTrades ?? await client.getTrades()).filter((trade) => matchesOrderId(trade, orderId));

  // Keep the current maker-scoped query as the fast path, but fall back to the
  // broader trade lookup when the order likely matched as taker and would be missed.
  if (makerAddress && matchedTrades.length === 0) {
    matchedTrades = (await client.getTrades()).filter((trade) => matchesOrderId(trade, orderId));
  }

  const tradeIds = matchedTrades.map((trade) => trade.id);
  const tokenIds = Array.from(new Set(matchedTrades.map((trade) => String(trade.asset_id ?? "")))).filter(Boolean);
  const latestTrade = matchedTrades
    .slice()
    .sort((left, right) => Number(right.last_update ?? 0) - Number(left.last_update ?? 0))[0];
  return {
    tradeIds,
    matchedOrderId: orderId,
    count: matchedTrades.length,
    tokenIds,
    latestPrice: latestTrade ? Number(latestTrade.price ?? 0) : 0,
    latestSide: latestTrade ? String(latestTrade.side ?? "") : "",
    latestStatus: latestTrade ? String(latestTrade.status ?? "") : "",
    raw: matchedTrades,
  };
}
