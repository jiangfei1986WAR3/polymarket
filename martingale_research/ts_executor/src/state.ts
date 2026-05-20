import fs from "node:fs";
import path from "node:path";

import type {
  AccountSnapshot,
  OrderSnapshot,
  PositionSnapshot,
  RuntimeStateV2,
  SessionContext,
  TradeSnapshot,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function makeDefaultRuntimeState(): RuntimeStateV2 {
  return {
    session: {
      accountMode: "eoa",
      walletAddress: "",
      funderAddress: "",
      signatureType: 0,
      connected: false,
      updatedAt: "",
    },
    strategy: {
      strategyVersion: "",
      mode: "phase_a_lifecycle",
    },
    run: {
      inRun: false,
      currentStep: null,
      lastProcessedCandleOpenTimeMs: null,
      pendingDecisionCandleOpenTimeMs: null,
      lastState: "",
      lastAction: "INIT",
      lastDirection: null,
      lastReason: "Initialized runtime state.",
      pendingDecisionReason: "",
      pauseReason: "",
      updatedAt: "",
      totalRunsStarted: 0,
      totalWins: 0,
      totalLosses: 0,
      totalBlowups: 0,
    },
    orders: {
      activeOrderIds: [],
      lastOrderId: "",
      lastOrderStatus: "",
      lastOrderTokenId: "",
      lastOrderConditionId: "",
      lastOrderSide: "",
      lastOrderPrice: 0,
      lastOrderSize: 0,
      updatedAt: "",
    },
    trades: {
      lastTradeIds: [],
      lastMatchedOrderId: "",
      lastTradeCount: 0,
      updatedAt: "",
    },
    positions: {
      lastPositionTokenId: "",
      lastPositionSize: 0,
      lastPositionSide: "",
      updatedAt: "",
    },
    account: {
      lastCollateralBalance: "",
      lastAllowance: "",
      updatedAt: "",
    },
    redemption: {
      status: "idle",
      lastAttemptedTokenId: "",
      lastAttemptedConditionId: "",
      lastAttemptedMarketStartTime: "",
      lastSubmittedTokenId: "",
      lastSubmittedConditionId: "",
      lastTransactionId: "",
      lastTransactionHash: "",
      lastError: "",
      updatedAt: "",
    },
    risk: {
      paused: false,
      pauseCode: "",
      pauseReason: "",
      consecutiveBlowups: 0,
      consecutiveApiFailures: 0,
      dailyLossU: 0,
      dailyLossDate: "",
      lastGuardDecision: "INIT",
      updatedAt: "",
    },
  };
}

export function loadRuntimeState(stateFile: string): RuntimeStateV2 {
  if (!fs.existsSync(stateFile)) {
    return makeDefaultRuntimeState();
  }
  const raw = fs.readFileSync(stateFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<RuntimeStateV2>;
  const base = makeDefaultRuntimeState();
  return {
    ...base,
    ...parsed,
    session: {
      ...base.session,
      ...(parsed.session ?? {}),
    },
    strategy: {
      ...base.strategy,
      ...(parsed.strategy ?? {}),
    },
    run: {
      ...base.run,
      ...(parsed.run ?? {}),
    },
    orders: {
      ...base.orders,
      ...(parsed.orders ?? {}),
    },
    trades: {
      ...base.trades,
      ...(parsed.trades ?? {}),
    },
    positions: {
      ...base.positions,
      ...(parsed.positions ?? {}),
    },
    account: {
      ...base.account,
      ...(parsed.account ?? {}),
    },
    redemption: {
      ...base.redemption,
      ...(parsed.redemption ?? {}),
    },
    risk: {
      ...base.risk,
      ...(parsed.risk ?? {}),
    },
  };
}

export function saveRuntimeState(stateFile: string, state: RuntimeStateV2): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function applySessionSnapshot(state: RuntimeStateV2, session: SessionContext): RuntimeStateV2 {
  return {
    ...state,
    session: {
      accountMode: session.accountMode,
      walletAddress: session.walletAddress,
      funderAddress: session.funderAddress,
      signatureType: session.signatureType,
      connected: true,
      updatedAt: nowIso(),
    },
  };
}

export function applyAccountSnapshot(state: RuntimeStateV2, snapshot: AccountSnapshot): RuntimeStateV2 {
  return {
    ...state,
    account: {
      lastCollateralBalance: snapshot.collateralBalance,
      lastAllowance: snapshot.allowance,
      updatedAt: snapshot.timestamp,
    },
  };
}

export function applyRedemptionState(
  state: RuntimeStateV2,
  redemption: RuntimeStateV2["redemption"],
): RuntimeStateV2 {
  return {
    ...state,
    redemption,
  };
}

export function applyOrderSnapshot(
  state: RuntimeStateV2,
  snapshot: OrderSnapshot,
  options?: {
    conditionId?: string;
  },
): RuntimeStateV2 {
  const activeOrderIds =
    snapshot.status.toLowerCase() === "live" || snapshot.status.toLowerCase() === "open"
      ? Array.from(new Set([...state.orders.activeOrderIds, snapshot.orderId]))
      : state.orders.activeOrderIds.filter((id) => id !== snapshot.orderId);

  return {
    ...state,
    orders: {
      activeOrderIds,
      lastOrderId: snapshot.orderId,
      lastOrderStatus: snapshot.status,
      lastOrderTokenId: snapshot.tokenId,
      lastOrderConditionId: options?.conditionId ?? state.orders.lastOrderConditionId,
      lastOrderSide: snapshot.side,
      lastOrderPrice: Number(snapshot.price || 0),
      lastOrderSize: Number(snapshot.originalSize || 0),
      updatedAt: nowIso(),
    },
  };
}

export function applyTradeSnapshot(state: RuntimeStateV2, snapshot: TradeSnapshot): RuntimeStateV2 {
  return {
    ...state,
    trades: {
      lastTradeIds: snapshot.tradeIds,
      lastMatchedOrderId: snapshot.matchedOrderId,
      lastTradeCount: snapshot.count,
      updatedAt: nowIso(),
    },
  };
}

export function applyPositionSnapshot(state: RuntimeStateV2, snapshot: PositionSnapshot): RuntimeStateV2 {
  return {
    ...state,
    positions: {
      lastPositionTokenId: snapshot.tokenId,
      lastPositionSize: snapshot.size,
      lastPositionSide: snapshot.side,
      updatedAt: nowIso(),
    },
  };
}

export function applyRunState(state: RuntimeStateV2, run: RuntimeStateV2["run"]): RuntimeStateV2 {
  return {
    ...state,
    run,
  };
}

export function applyRiskState(state: RuntimeStateV2, risk: RuntimeStateV2["risk"]): RuntimeStateV2 {
  return {
    ...state,
    risk,
  };
}
