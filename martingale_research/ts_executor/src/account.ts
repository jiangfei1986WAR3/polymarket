import type { ClobClient } from "@polymarket/clob-client-v2";

import type { AccountSnapshot, SessionContext } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function getCollateralSnapshot(
  client: ClobClient,
  session: SessionContext,
): Promise<AccountSnapshot> {
  const raw = (await client.getBalanceAllowance({
    asset_type: "COLLATERAL",
    signature_type: session.signatureType,
  } as never)) as unknown;

  const data = raw as Record<string, unknown>;
  const allowance = (() => {
    if (data.allowance !== undefined) {
      return String(data.allowance);
    }
    const allowances = data.allowances as Record<string, unknown> | undefined;
    if (allowances) {
      const first = Object.values(allowances)[0];
      return first === undefined ? "" : String(first);
    }
    return "";
  })();

  return {
    collateralBalance: String(data.balance ?? data.available ?? data.balanceAvailable ?? ""),
    allowance,
    timestamp: nowIso(),
    raw,
  };
}
