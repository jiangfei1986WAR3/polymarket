import fs from "node:fs";
import path from "node:path";

import type {
  AllowedStatesBundle,
  StrategyCatalogEntry,
  StrategyConfigBundle,
  StrategyWalkForwardSummary,
} from "./types.js";

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function applyStrategyOverrides(
  strategy: StrategyConfigBundle,
  options?: {
    baseStakeUOverride?: number | null;
  },
): StrategyConfigBundle {
  const baseStakeUOverride = options?.baseStakeUOverride;
  if (baseStakeUOverride === null || baseStakeUOverride === undefined || !Number.isFinite(baseStakeUOverride)) {
    return strategy;
  }
  return {
    ...strategy,
    baseStakeU: Number(baseStakeUOverride),
  };
}

function readWalkForwardSummary(strategyDir: string): StrategyWalkForwardSummary | null {
  const filePath = path.join(strategyDir, "walk_forward_summary.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = readJson(filePath) as {
    version?: unknown;
    pattern?: unknown;
    coverage_target?: unknown;
    n_steps?: unknown;
    total_entries?: unknown;
    total_blowups?: unknown;
    total_pnl_u?: unknown;
    max_step_drawdown_u?: unknown;
    avg_entries_per_step?: unknown;
    steps?: Array<{
      test_pnl_u?: unknown;
      allowed_states_count?: unknown;
      train_coverage?: unknown;
    }>;
  };

  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const profitableSteps = steps.filter((step) => Number(step.test_pnl_u ?? 0) > 0).length;
  const losingSteps = steps.filter((step) => Number(step.test_pnl_u ?? 0) < 0).length;
  const stableSteps = steps.length - profitableSteps - losingSteps;
  const latestStep = steps.at(-1);
  const avgTrainCoverage =
    steps.length > 0 ? steps.reduce((sum, step) => sum + Number(step.train_coverage ?? 0), 0) / steps.length : 0;

  return {
    version: String(raw.version ?? ""),
    pattern: String(raw.pattern ?? ""),
    coverageTarget: Number(raw.coverage_target ?? 0),
    nSteps: Number(raw.n_steps ?? steps.length),
    totalEntries: Number(raw.total_entries ?? 0),
    totalBlowups: Number(raw.total_blowups ?? 0),
    totalPnlU: Number(raw.total_pnl_u ?? 0),
    maxStepDrawdownU: Number(raw.max_step_drawdown_u ?? 0),
    avgEntriesPerStep: Number(raw.avg_entries_per_step ?? 0),
    profitableSteps,
    losingSteps,
    stableSteps,
    latestAllowedStatesCount: Number(latestStep?.allowed_states_count ?? 0),
    avgTrainCoverage: Number(avgTrainCoverage.toFixed(6)),
  };
}

function readAutoScanSummary(strategyRoot: string): { recommendedVersion: string } | null {
  const filePath = path.join(strategyRoot, "auto-scan-summary.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = readJson(filePath) as {
    recommended_version?: unknown;
  };
  const recommendedVersion = String(raw.recommended_version ?? "").trim();
  return recommendedVersion ? { recommendedVersion } : null;
}

function calculateRecommendationScore(entry: {
  coverageTarget: number;
  walkForward: StrategyWalkForwardSummary | null;
}): number {
  const walk = entry.walkForward;
  if (!walk) {
    return Number.NEGATIVE_INFINITY;
  }

  const targetCoverage = 0.6;
  const coveragePenalty = Math.abs(entry.coverageTarget - targetCoverage) * 1000;
  const pnlScore = walk.totalPnlU;
  const blowupPenalty = walk.totalBlowups * 18;
  const drawdownPenalty = walk.maxStepDrawdownU * 0.35;
  const consistencyBonus = walk.profitableSteps * 1.5;

  return Number((pnlScore - coveragePenalty - blowupPenalty - drawdownPenalty + consistencyBonus).toFixed(4));
}

function buildRecommendationReason(entry: StrategyCatalogEntry): string {
  if (!entry.walkForward) {
    return "该策略缺少 walk-forward 摘要，暂不参与推荐。";
  }
  if (entry.recommended) {
    return `当前按“覆盖率接近 60% + 样本外总收益为正 + 回撤可控”规则推荐这套策略。`;
  }
  return `这套策略可作为候选；覆盖率 ${Math.round(entry.coverageTarget * 100)}%，样本外收益 ${entry.walkForward.totalPnlU.toFixed(2)}U。`;
}

export function loadStrategyBundle(
  strategyDir: string,
  options?: {
    baseStakeUOverride?: number | null;
  },
): {
  strategy: StrategyConfigBundle;
  allowedStates: AllowedStatesBundle;
} {
  const configPath = path.join(strategyDir, "strategy_config.json");
  const allowedStatesPath = path.join(strategyDir, "allowed_states.json");

  const configRaw = readJson(configPath) as Record<string, unknown>;
  const allowedRaw = readJson(allowedStatesPath) as Record<string, unknown>;

  const strategy = applyStrategyOverrides({
    version: String(configRaw.version ?? ""),
    generatedAtUtc: String(configRaw.generated_at_utc ?? ""),
    pattern: String(configRaw.pattern ?? ""),
    coverageTarget: Number(configRaw.coverage_target ?? 0),
    riskHorizonH: Number(configRaw.risk_horizon_h ?? 0),
    trainWindowDays: Number(configRaw.train_window_days ?? 0),
    stepDays: Number(configRaw.step_days ?? 0),
    baseStakeU: Number(configRaw.base_stake_u ?? 0),
    maxSteps: Number(configRaw.max_steps ?? 0),
    allowedStatesCount: Number(configRaw.allowed_states_count ?? 0),
  }, options);

  const allowedStates: AllowedStatesBundle = {
    version: String(allowedRaw.version ?? ""),
    pattern: String(allowedRaw.pattern ?? ""),
    coverageTarget: Number(allowedRaw.coverage_target ?? 0),
    allowedStates: new Set(
      Array.isArray(allowedRaw.allowed_states) ? allowedRaw.allowed_states.map((item) => String(item)) : [],
    ),
  };

  if (strategy.version !== allowedStates.version) {
    throw new Error("strategy_config and allowed_states version mismatch");
  }
  if (strategy.pattern !== allowedStates.pattern) {
    throw new Error("strategy_config and allowed_states pattern mismatch");
  }

  return { strategy, allowedStates };
}

export function listStrategyCatalog(strategyRoot: string): StrategyCatalogEntry[] {
  if (!fs.existsSync(strategyRoot) || !fs.statSync(strategyRoot).isDirectory()) {
    return [];
  }

  const entries = fs
    .readdirSync(strategyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(strategyRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "strategy_config.json")) && fs.existsSync(path.join(dir, "allowed_states.json")));

  const catalog = entries
    .map((dir) => {
      const { strategy } = loadStrategyBundle(dir);
      const walkForward = readWalkForwardSummary(dir);
      const name = path.basename(dir);
      return {
        key: name,
        label: name,
        dir,
        version: strategy.version,
        generatedAtUtc: strategy.generatedAtUtc,
        pattern: strategy.pattern,
        coverageTarget: strategy.coverageTarget,
        riskHorizonH: strategy.riskHorizonH,
        trainWindowDays: strategy.trainWindowDays,
        stepDays: strategy.stepDays,
        baseStakeU: strategy.baseStakeU,
        maxSteps: strategy.maxSteps,
        allowedStatesCount: strategy.allowedStatesCount,
        walkForward,
        recommendationScore: calculateRecommendationScore({
          coverageTarget: strategy.coverageTarget,
          walkForward,
        }),
        recommended: false,
        selected: false,
        recommendationReason: "",
      } satisfies StrategyCatalogEntry;
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const autoScanSummary = readAutoScanSummary(strategyRoot);
  let recommendedKey = autoScanSummary?.recommendedVersion ?? "";
  if (!recommendedKey || !catalog.some((entry) => entry.key === recommendedKey)) {
    recommendedKey = "";
    for (const entry of catalog) {
      if (!recommendedKey || entry.recommendationScore > (catalog.find((item) => item.key === recommendedKey)?.recommendationScore ?? Number.NEGATIVE_INFINITY)) {
        recommendedKey = entry.key;
      }
    }
  }

  return catalog.map((entry) => {
    const recommended = entry.key === recommendedKey && Number.isFinite(entry.recommendationScore);
    return {
      ...entry,
      recommended,
      recommendationReason: buildRecommendationReason({
        ...entry,
        recommended,
      }),
    };
  });
}
