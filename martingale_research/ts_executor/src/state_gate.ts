import type { AllowedStatesBundle, StrategyConfigBundle, StrategyDecision } from "./types.js";

function patternDirection(pattern: string, step: number): "U" | "D" {
  if (step < 1 || step > pattern.length) {
    throw new Error("step out of range");
  }
  const value = pattern[step - 1];
  if (value !== "U" && value !== "D") {
    throw new Error(`Unexpected pattern direction: ${value}`);
  }
  return value;
}

export function evaluateStrategyDecision(args: {
  currentState: string;
  strategy: StrategyConfigBundle;
  allowedStates: AllowedStatesBundle;
  currentStep?: number | null;
}): StrategyDecision {
  const { currentState, strategy, allowedStates } = args;
  const currentStep = args.currentStep ?? null;
  if (currentStep !== null && (currentStep < 1 || currentStep > strategy.maxSteps)) {
    throw new Error("currentStep must be between 1 and maxSteps");
  }

  const isAllowed = allowedStates.allowedStates.has(currentState);

  if (currentStep !== null) {
    return {
      version: strategy.version,
      pattern: strategy.pattern,
      currentState,
      isAllowed,
      inRun: true,
      currentStep,
      nextStep: currentStep,
      nextDirection: patternDirection(strategy.pattern, currentStep),
      recommendedAction: `BET_STEP_${currentStep}`,
      reason: "当前已经处于一轮马丁中，继续按固定 pattern 执行当前步。",
    };
  }

  if (!isAllowed) {
    return {
      version: strategy.version,
      pattern: strategy.pattern,
      currentState,
      isAllowed: false,
      inRun: false,
      currentStep: null,
      nextStep: null,
      nextDirection: null,
      recommendedAction: "BLOCK",
      reason: "当前最近 6 根K线形成的 state 不在 allowed_states 白名单内。",
    };
  }

  return {
    version: strategy.version,
    pattern: strategy.pattern,
    currentState,
    isAllowed: true,
    inRun: false,
    currentStep: null,
    nextStep: 1,
    nextDirection: patternDirection(strategy.pattern, 1),
    recommendedAction: "START_RUN",
    reason: "当前 state 在 allowed_states 白名单内，允许启动新一轮马丁。",
  };
}
