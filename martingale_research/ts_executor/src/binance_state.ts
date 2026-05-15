import type { CandleSnapshot, ExecutorConfig } from "./types.js";

function mapRow(row: unknown): CandleSnapshot {
  if (!Array.isArray(row) || row.length < 6) {
    throw new Error("Unexpected Binance kline row shape");
  }
  return {
    openTimeMs: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

export async function fetchRecentBinance1hCandles(
  config: ExecutorConfig,
  limit = 6,
): Promise<CandleSnapshot[]> {
  const url = new URL("/api/v3/klines", config.binanceApiBaseUrl);
  url.searchParams.set("symbol", config.binanceSymbol);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "polymarket-ts-executor/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Binance klines request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Unexpected Binance klines response");
  }
  return raw.map((row) => mapRow(row)).sort((left, right) => left.openTimeMs - right.openTimeMs);
}

export async function fetchRecentClosedBinance1hCandles(
  config: ExecutorConfig,
  limit = 6,
  now = new Date(),
): Promise<CandleSnapshot[]> {
  const rawCandles = await fetchRecentBinance1hCandles(config, Math.max(limit + 2, 10));
  const currentHourOpenTimeMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0,
  );
  const closed = rawCandles.filter((candle) => candle.openTimeMs < currentHourOpenTimeMs);
  if (closed.length < limit) {
    throw new Error(`Not enough closed Binance candles. Need ${limit}, got ${closed.length}`);
  }
  return closed.slice(-limit);
}

export function recentStateString(candles: CandleSnapshot[], stateLen = 6): string {
  if (stateLen <= 0) {
    throw new Error("stateLen must be positive");
  }
  if (candles.length < stateLen) {
    throw new Error("Not enough candles to compute current state");
  }

  return candles
    .slice(-stateLen)
    .map((candle) => (candle.close >= candle.open ? "U" : "D"))
    .join("");
}
