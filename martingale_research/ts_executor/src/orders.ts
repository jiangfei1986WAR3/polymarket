import { OrderType, Side } from "@polymarket/clob-client-v2";
import type { ClobClient } from "@polymarket/clob-client-v2";

import type { OrderIntent, OrderSnapshot } from "./types.js";

function normalizeLimitOrderType(orderType: OrderIntent["orderType"]): OrderType.GTC | OrderType.GTD {
  switch (orderType) {
    case "GTD":
      return OrderType.GTD;
    case "FOK":
    case "FAK":
      throw new Error(`Order type ${orderType} is not supported by createAndPostOrder`);
    case "GTC":
    default:
      return OrderType.GTC;
  }
}

function normalizeMarketOrderType(orderType: OrderIntent["orderType"]): OrderType.FOK | OrderType.FAK {
  switch (orderType) {
    case "FAK":
      return OrderType.FAK;
    case "FOK":
    default:
      return OrderType.FOK;
  }
}

function sideToSdk(side: OrderIntent["side"]): Side {
  return side === "SELL" ? Side.SELL : Side.BUY;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEpochToIso(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return nowIso();
  }
  const epochMs = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  return new Date(epochMs).toISOString();
}

export async function postLimitOrder(client: ClobClient, intent: OrderIntent): Promise<unknown> {
  const tickSize = await client.getTickSize(intent.tokenId);
  const negRisk = await client.getNegRisk(intent.tokenId);

  if (intent.orderType === "FOK" || intent.orderType === "FAK") {
    return client.createAndPostMarketOrder(
      {
        tokenID: intent.tokenId,
        amount: intent.amount,
        side: sideToSdk(intent.side),
        price: intent.price,
      },
      {
        tickSize,
        negRisk,
      },
      normalizeMarketOrderType(intent.orderType),
    );
  }

  return client.createAndPostOrder(
    {
      tokenID: intent.tokenId,
      price: intent.price,
      size: intent.size,
      side: sideToSdk(intent.side),
    },
    {
      tickSize,
      negRisk,
    },
    normalizeLimitOrderType(intent.orderType),
  );
}

export async function getOrderSnapshot(client: ClobClient, orderId: string): Promise<OrderSnapshot> {
  const rawValue = await client.getOrder(orderId);
  if (!rawValue) {
    return {
      orderId,
      status: "NOT_FOUND",
      tokenId: "",
      side: "",
      price: "",
      originalSize: "",
      matchedSize: "",
      outcome: "",
      createdAt: nowIso(),
      raw: null,
    };
  }

  const raw = rawValue as unknown as Record<string, unknown>;
  return {
    orderId: String(raw.id ?? orderId),
    status: String(raw.status ?? ""),
    tokenId: String(raw.asset_id ?? ""),
    side: String(raw.side ?? ""),
    price: String(raw.price ?? ""),
    originalSize: String(raw.original_size ?? ""),
    matchedSize: String(raw.size_matched ?? ""),
    outcome: String(raw.outcome ?? ""),
    createdAt: normalizeEpochToIso(raw.created_at),
    raw,
  };
}

export async function cancelOrder(client: ClobClient, orderId: string): Promise<unknown> {
  return client.cancelOrder({ orderID: orderId });
}
