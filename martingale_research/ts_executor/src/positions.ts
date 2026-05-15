import type { ExecutorConfig, PositionSnapshot, SessionContext } from "./types.js";

function normalizeRow(
  row: Record<string, unknown>,
  fallbackUser: string,
  preferredTokenId?: string,
): PositionSnapshot {
  const forcedTokenId = preferredTokenId && preferredTokenId.trim() ? preferredTokenId : undefined;
  return {
    user: String(row.user ?? row.owner ?? fallbackUser),
    tokenId: String(
      forcedTokenId ??
        row.asset ?? row.asset_id ?? row.tokenId ?? row.token_id ?? row.conditionId ?? "",
    ),
    size: Number(row.size ?? row.balance ?? row.amount ?? row.shares ?? 0),
    side: String(row.side ?? row.outcome ?? row.position ?? ""),
    entryPrice: Number(row.entry_price ?? row.avg_price ?? row.avgPrice ?? row.averagePrice ?? row.price ?? 0),
    count: 1,
    raw: row,
  };
}

export async function getPositionsSnapshot(
  config: ExecutorConfig,
  session: SessionContext,
  preferredTokenId?: string,
): Promise<PositionSnapshot> {
  const user = session.funderAddress || session.walletAddress;
  const url = new URL("/positions", config.dataApiBaseUrl);
  url.searchParams.set("user", user);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "polymarket-ts-executor/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Positions request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as unknown;
  const rows = Array.isArray(raw) ? raw : [];
  const preferred =
    rows.find((item) => {
      const row = item as Record<string, unknown>;
      const tokenId = String(row.asset ?? row.asset_id ?? row.tokenId ?? row.token_id ?? "");
      return preferredTokenId ? tokenId === preferredTokenId : true;
    }) ?? null;

  if (!preferred) {
    return {
      user,
      tokenId: preferredTokenId ?? "",
      size: 0,
      side: "",
      entryPrice: 0,
      count: rows.length,
      raw,
    };
  }

  const snapshot = normalizeRow(preferred as Record<string, unknown>, user, preferredTokenId);
  return {
    ...snapshot,
    count: rows.length,
    raw,
  };
}
