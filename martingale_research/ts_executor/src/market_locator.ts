import type { ExecutorConfig, LocatedMarket, MarketOutcomeToken } from "./types.js";

const BTC_1H_SERIES_SLUG = "btc-up-or-down-hourly";
const USER_AGENT = "polymarket-ts-executor/0.1";

interface MarketLocatorOptions {
  seriesSlug?: string;
  targetTime?: Date;
  pageLimit?: number;
  maxPages?: number;
  includeClosed?: boolean;
  requireExactStart?: boolean;
}

function floorToHour(value: Date): Date {
  const next = new Date(value);
  next.setUTCMinutes(0, 0, 0);
  return next;
}

function normalizeJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseOutcomeTokens(row: Record<string, unknown>): MarketOutcomeToken[] {
  const outcomes = normalizeJsonArray(row.outcomes);
  const tokenIds = normalizeJsonArray(row.clobTokenIds);
  const prices = normalizeJsonArray(row.outcomePrices);

  return outcomes.map((outcome, index) => ({
    outcome,
    tokenId: tokenIds[index] ?? "",
    price: prices[index] ?? "",
  }));
}

function parseEventStartTime(row: Record<string, unknown>): string {
  if (typeof row.eventStartTime === "string" && row.eventStartTime) {
    return row.eventStartTime;
  }
  const endDate = typeof row.endDate === "string" ? row.endDate : "";
  const endMs = Date.parse(endDate);
  if (!Number.isFinite(endMs)) {
    return "";
  }
  return new Date(endMs - 60 * 60 * 1000).toISOString();
}

function parseLocatedMarketFromEvent(eventRow: Record<string, unknown>): LocatedMarket | null {
  const marketRows = Array.isArray(eventRow.markets) ? (eventRow.markets as Record<string, unknown>[]) : [];
  const marketRow = marketRows[0];
  if (!marketRow) {
    return null;
  }
  const seriesRows = Array.isArray(eventRow.series) ? (eventRow.series as Record<string, unknown>[]) : [];
  const seriesRow = seriesRows[0] ?? {};

  return {
    marketId: String(marketRow.id ?? ""),
    conditionId: String(marketRow.conditionId ?? marketRow.condition_id ?? ""),
    slug: String(marketRow.slug ?? eventRow.slug ?? ""),
    question: String(marketRow.question ?? eventRow.title ?? ""),
    eventSlug: String(eventRow.slug ?? marketRow.slug ?? ""),
    eventTitle: String(eventRow.title ?? marketRow.question ?? ""),
    seriesSlug: String(eventRow.seriesSlug ?? seriesRow.slug ?? ""),
    acceptingOrders: Boolean(marketRow.acceptingOrders ?? false),
    active: Boolean(marketRow.active ?? eventRow.active ?? false),
    closed: Boolean(marketRow.closed ?? eventRow.closed ?? false),
    eventStartTime: parseEventStartTime(marketRow),
    endDate: String(marketRow.endDate ?? eventRow.endDate ?? ""),
    orderMinSize: parseNumber(marketRow.orderMinSize),
    tickSize: parseNumber(marketRow.orderPriceMinTickSize),
    negRisk: Boolean(marketRow.negRisk ?? eventRow.negRisk ?? false),
    outcomes: parseOutcomeTokens(marketRow),
    raw: eventRow,
  };
}

function selectBestMarket(markets: LocatedMarket[], targetTime: Date): LocatedMarket | null {
  const targetMs = floorToHour(targetTime).getTime();
  const exact = markets.find((market) => {
    const eventMs = Date.parse(market.eventStartTime);
    return Number.isFinite(eventMs) && eventMs === targetMs;
  });
  if (exact) {
    return exact;
  }

  const future = markets
    .filter((market) => {
      const eventMs = Date.parse(market.eventStartTime);
      return Number.isFinite(eventMs) && eventMs >= targetMs;
    })
    .sort((left, right) => Date.parse(left.eventStartTime) - Date.parse(right.eventStartTime));
  if (future.length > 0) {
    return future[0];
  }

  const past = markets
    .filter((market) => Number.isFinite(Date.parse(market.eventStartTime)))
    .sort((left, right) => Date.parse(right.eventStartTime) - Date.parse(left.eventStartTime));
  return past[0] ?? null;
}

function selectExactMarket(markets: LocatedMarket[], targetTime: Date): LocatedMarket | null {
  const targetMs = floorToHour(targetTime).getTime();
  return (
    markets.find((market) => {
      const eventMs = Date.parse(market.eventStartTime);
      return Number.isFinite(eventMs) && eventMs === targetMs;
    }) ?? null
  );
}

async function fetchEventPage(
  config: ExecutorConfig,
  offset: number,
  limit: number,
  seriesSlug: string,
  includeClosed: boolean,
): Promise<Record<string, unknown>[]> {
  const url = new URL("/events", config.gammaApiBaseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (!includeClosed) {
    url.searchParams.set("closed", "false");
  }
  url.searchParams.set("series_slug", seriesSlug);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Gamma markets request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as unknown;
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

export async function locateCurrentBtc1hMarket(
  config: ExecutorConfig,
  options: MarketLocatorOptions = {},
): Promise<LocatedMarket | null> {
  const seriesSlug = options.seriesSlug ?? BTC_1H_SERIES_SLUG;
  const targetTime = options.targetTime ?? new Date();
  const pageLimit = options.pageLimit ?? 100;
  const maxPages = options.maxPages ?? 3;
  const includeClosed = options.includeClosed ?? false;
  const requireExactStart = options.requireExactStart ?? false;

  const collected: LocatedMarket[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchEventPage(config, page * pageLimit, pageLimit, seriesSlug, includeClosed);
    if (rows.length === 0) {
      break;
    }
    const parsed = rows
      .map((row) => parseLocatedMarketFromEvent(row))
      .filter((market): market is LocatedMarket => Boolean(market))
      .filter((market) => market.seriesSlug === seriesSlug || market.eventSlug.includes("bitcoin-up-or-down"));
    collected.push(...parsed);
    if (rows.length < pageLimit) {
      break;
    }
  }

  return requireExactStart ? selectExactMarket(collected, targetTime) : selectBestMarket(collected, targetTime);
}
