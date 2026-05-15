import type { ExecutorConfig, RuntimeStateV2, StrategyConfigBundle } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function stepLossU(baseStakeU: number, step: number): number {
  return Number((baseStakeU * 2 ** (step - 1)).toFixed(6));
}

export function normalizeRiskState(state: RuntimeStateV2, now = new Date()): RuntimeStateV2 {
  const today = utcDateKey(now);
  if (state.risk.dailyLossDate === today) {
    return state;
  }
  return {
    ...state,
    risk: {
      ...state.risk,
      dailyLossU: 0,
      dailyLossDate: today,
      lastGuardDecision: "ROLLED_DAILY_WINDOW",
      updatedAt: nowIso(),
    },
  };
}

export function applyOutcomeToRisk(args: {
  state: RuntimeStateV2;
  strategy: StrategyConfigBundle;
  outcome: "win" | "loss" | null;
  resolvedStep: number | null;
  blewUp: boolean;
}): RuntimeStateV2 {
  const { state, strategy, outcome, resolvedStep, blewUp } = args;
  if (outcome === null || resolvedStep === null) {
    return state;
  }

  if (outcome === "win") {
    return {
      ...state,
      risk: {
        ...state.risk,
        consecutiveBlowups: 0,
        lastGuardDecision: "RECORDED_WIN",
        updatedAt: nowIso(),
      },
    };
  }

  const realizedLoss = stepLossU(strategy.baseStakeU, resolvedStep);
  return {
    ...state,
    risk: {
      ...state.risk,
      dailyLossU: Number((state.risk.dailyLossU + realizedLoss).toFixed(6)),
      consecutiveBlowups: blewUp ? state.risk.consecutiveBlowups + 1 : state.risk.consecutiveBlowups,
      lastGuardDecision: blewUp ? "RECORDED_BLOWUP" : "RECORDED_LOSS",
      updatedAt: nowIso(),
    },
  };
}

export function clearApiFailureCounter(state: RuntimeStateV2): RuntimeStateV2 {
  if (state.risk.consecutiveApiFailures === 0) {
    return state;
  }
  return {
    ...state,
    risk: {
      ...state.risk,
      consecutiveApiFailures: 0,
      lastGuardDecision: "RESET_API_FAILURES",
      updatedAt: nowIso(),
    },
  };
}

export function registerApiFailure(
  state: RuntimeStateV2,
  reason: string,
): RuntimeStateV2 {
  return {
    ...state,
    risk: {
      ...state.risk,
      consecutiveApiFailures: state.risk.consecutiveApiFailures + 1,
      lastGuardDecision: `API_FAILURE:${reason}`,
      updatedAt: nowIso(),
    },
  };
}

export function evaluateRiskLimits(
  state: RuntimeStateV2,
  config: ExecutorConfig,
): { shouldPause: boolean; pauseCode: string; pauseReason: string } {
  if (config.maxDailyLossU > 0 && state.risk.dailyLossU >= config.maxDailyLossU) {
    return {
      shouldPause: true,
      pauseCode: "DAILY_LOSS_LIMIT",
      pauseReason: `当日累计亏损 ${state.risk.dailyLossU}U 已达到阈值 ${config.maxDailyLossU}U，暂停交易。`,
    };
  }

  if (config.maxConsecutiveBlowups > 0 && state.risk.consecutiveBlowups >= config.maxConsecutiveBlowups) {
    return {
      shouldPause: true,
      pauseCode: "CONSECUTIVE_BLOWUPS",
      pauseReason: `连续爆仓次数 ${state.risk.consecutiveBlowups} 已达到阈值 ${config.maxConsecutiveBlowups}，暂停交易。`,
    };
  }

  if (config.maxApiFailures > 0 && state.risk.consecutiveApiFailures >= config.maxApiFailures) {
    return {
      shouldPause: true,
      pauseCode: "API_FAILURE_LIMIT",
      pauseReason: `连续 API 失败次数 ${state.risk.consecutiveApiFailures} 已达到阈值 ${config.maxApiFailures}，暂停交易。`,
    };
  }

  return {
    shouldPause: false,
    pauseCode: "",
    pauseReason: "",
  };
}
