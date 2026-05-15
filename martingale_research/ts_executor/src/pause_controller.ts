import type { RuntimeStateV2 } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function pauseRuntimeState(
  state: RuntimeStateV2,
  pauseCode: string,
  pauseReason: string,
  guardDecision = "PAUSED",
): RuntimeStateV2 {
  return {
    ...state,
    run: {
      ...state.run,
      pauseReason,
      lastReason: pauseReason,
      updatedAt: nowIso(),
    },
    risk: {
      ...state.risk,
      paused: true,
      pauseCode,
      pauseReason,
      lastGuardDecision: guardDecision,
      updatedAt: nowIso(),
    },
  };
}

export function resumeRuntimeState(
  state: RuntimeStateV2,
  reason = "Runtime resumed.",
  guardDecision = "RESUMED",
): RuntimeStateV2 {
  return {
    ...state,
    run: {
      ...state.run,
      pauseReason: "",
      lastReason: reason,
      updatedAt: nowIso(),
    },
    risk: {
      ...state.risk,
      paused: false,
      pauseCode: "",
      pauseReason: "",
      lastGuardDecision: guardDecision,
      updatedAt: nowIso(),
    },
  };
}
