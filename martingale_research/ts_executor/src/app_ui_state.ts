import fs from "node:fs";
import path from "node:path";

import { buildExecutorConfigFromAppConfig, loadAppConfig, makeDefaultAppConfig, summarizeAppConfig, validateAppConfig } from "./app_config.js";
import { getDaemonStatusSnapshot } from "./daemon_status.js";
import { loadExecutorConfig } from "./config.js";
import { loadRuntimeState } from "./state.js";
import { listStrategyCatalog, loadStrategyBundle } from "./strategy_loader.js";
import type { AppUiBanner, AppUiLogEntry, AppUiState, ExecutionEvent } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function safeReadRecentExecutionEvents(logFile: string, limit: number): AppUiLogEntry[] {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  const raw = fs.readFileSync(logFile, "utf8").trim();
  if (!raw) {
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, limit));

  const entries: AppUiLogEntry[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ExecutionEvent;
      entries.push({
        timestamp: event.timestamp,
        eventType: event.eventType,
        message: event.message,
        orderId: event.orderId,
        tokenId: event.tokenId,
      });
    } catch {
      entries.push({
        timestamp: "",
        eventType: "UNPARSEABLE_LOG_LINE",
        message: line,
      });
    }
  }

  return entries.reverse();
}

function buildBanners(args: {
  configPresent: boolean;
  configValid: boolean;
  health: AppUiState["overview"]["health"];
  pauseCode: string;
  pauseReason: string;
  lastError: string;
  issuesCount: number;
}): AppUiBanner[] {
  const banners: AppUiBanner[] = [];

  if (!args.configPresent) {
    banners.push({
      level: "warning",
      code: "CONFIG_MISSING",
      title: "配置文件不存在",
      detail: "当前还没有找到 app_config.json，最终 EXE 无法直接启动守护进程。",
      suggestedAction: "先初始化或复制 app_config.example.json 并填写真实参数。",
    });
  } else if (!args.configValid) {
    banners.push({
      level: "error",
      code: "CONFIG_INVALID",
      title: "配置校验未通过",
      detail: `当前配置存在 ${args.issuesCount} 个校验问题。`,
      suggestedAction: "先修复配置项，再允许启动或部署计划任务。",
    });
  }

  if (args.health === "error") {
    banners.push({
      level: "error",
      code: "DAEMON_ERROR",
      title: "守护进程报错",
      detail: args.lastError || "runner 进入 error 状态，但没有附带错误详情。",
      suggestedAction: "查看 stderr 日志并决定是否重启。",
    });
  } else if (args.health === "stale") {
    banners.push({
      level: "warning",
      code: "DAEMON_STALE",
      title: "心跳超时",
      detail: "runner 心跳超过阈值未更新，可能已失联或卡住。",
      suggestedAction: "先看 status 和日志，再执行 restart。",
    });
  } else if (args.health === "runtime_paused") {
    banners.push({
      level: "info",
      code: args.pauseCode || "RUNTIME_PAUSED",
      title: "运行时已暂停",
      detail: args.pauseReason || "系统当前处于暂停态。",
      suggestedAction: "确认原因后再执行 resume。",
    });
  } else if (args.health === "sleeping" || args.health === "running") {
    banners.push({
      level: "success",
      code: "DAEMON_HEALTHY",
      title: "守护进程运行正常",
      detail: "runner 正在工作或等待下一次 tick。",
      suggestedAction: "可继续观察日志和心跳，无需人工干预。",
    });
  } else if (args.health === "stopped" || args.health === "never_started") {
    banners.push({
      level: "info",
      code: "DAEMON_STOPPED",
      title: "守护进程当前未运行",
      detail: "当前没有活动中的 runner 进程。",
      suggestedAction: "检查配置无误后执行 start。",
    });
  }

  return banners;
}

function deriveCards(state: AppUiState): AppUiState["pages"]["dashboard"]["cards"] {
  const healthTone =
    state.overview.health === "running" || state.overview.health === "sleeping"
      ? "good"
      : state.overview.health === "error" || state.overview.health === "stale"
        ? "danger"
        : state.overview.health === "runtime_paused"
          ? "warning"
          : "neutral";

  return [
    { key: "health", label: "Daemon Health", value: state.overview.health, tone: healthTone },
    {
      key: "mode",
      label: "Trading Mode",
      value: state.overview.executeLive ? "live_execute" : "dry_run",
      tone: state.overview.executeLive ? "warning" : "neutral",
    },
    {
      key: "interval",
      label: "Tick Interval",
      value: `${state.overview.intervalMs} ms`,
      tone: "neutral",
    },
    {
      key: "step",
      label: "Current Step",
      value: state.overview.currentStep === null ? "idle" : String(state.overview.currentStep),
      tone: state.overview.currentStep === null ? "neutral" : "warning",
    },
    {
      key: "order",
      label: "Last Order",
      value: state.overview.activeOrderId || "none",
      tone: state.overview.activeOrderId ? "warning" : "neutral",
    },
  ];
}

function computeStake(baseStakeU: number, step: number | null): number | null {
  if (!Number.isFinite(baseStakeU) || baseStakeU <= 0) {
    return null;
  }
  const resolvedStep = step ?? 1;
  if (!Number.isFinite(resolvedStep) || resolvedStep <= 0) {
    return null;
  }
  return Number((baseStakeU * 2 ** (resolvedStep - 1)).toFixed(8));
}

export function buildAppUiState(args?: {
  configFile?: string;
  staleAfterMs?: number;
  logLimit?: number;
}): AppUiState {
  const configFile = path.resolve(args?.configFile ?? path.join(process.cwd(), "app_config.json"));
  const configBaseDir = path.dirname(configFile);
  const configPresent = fs.existsSync(configFile);
  const config = configPresent ? loadAppConfig(configFile) : null;
  const configIssues = config ? validateAppConfig(config) : [];
  const configValid = configPresent && configIssues.length === 0;
  const configSummary = config
    ? summarizeAppConfig(config)
    : summarizeAppConfig(makeDefaultAppConfig(configBaseDir));
  const executorConfig = configValid && config ? buildExecutorConfigFromAppConfig(config) : loadExecutorConfig();
  const daemon = getDaemonStatusSnapshot(args?.staleAfterMs ?? 180_000, executorConfig);
  const runtimeState = loadRuntimeState(daemon.stateFile);
  const entries = safeReadRecentExecutionEvents(daemon.eventsLogFile, args?.logLimit ?? 20);
  const strategyRoot = path.dirname((config?.trading.strategyDir ?? executorConfig.strategyDir) || executorConfig.strategyDir);
  const activeStrategyDir = config?.trading.strategyDir ?? executorConfig.strategyDir;
  const availableStrategies = listStrategyCatalog(strategyRoot).map((entry) => ({
    ...entry,
    selected: entry.dir === activeStrategyDir,
  }));
  const recommendedStrategy = availableStrategies.find((entry) => entry.recommended) ?? null;
  const runningVersion = runtimeState.strategy.strategyVersion || "";
  const runningStrategyMeta =
    availableStrategies.find((entry) => entry.version === runningVersion) ??
    availableStrategies.find((entry) => entry.dir === activeStrategyDir) ??
    null;
  let activeStrategy: AppUiState["pages"]["strategy"]["active"] = null;
  try {
    const { strategy } = loadStrategyBundle(activeStrategyDir, {
      baseStakeUOverride: config?.trading.baseStakeU ?? executorConfig.baseStakeU,
    });
    const selectedMeta = availableStrategies.find((entry) => entry.dir === activeStrategyDir) ?? null;
    activeStrategy = {
      version: strategy.version,
      generatedAtUtc: strategy.generatedAtUtc,
      pattern: strategy.pattern,
      coverageTarget: strategy.coverageTarget,
      trainWindowDays: strategy.trainWindowDays,
      stepDays: strategy.stepDays,
      baseStakeU: strategy.baseStakeU,
      maxSteps: strategy.maxSteps,
      allowedStatesCount: strategy.allowedStatesCount,
      strategyDir: config?.trading.strategyDir ?? executorConfig.strategyDir,
      currentStep: runtimeState.run.currentStep,
      currentStakeU: runtimeState.run.currentStep ? computeStake(strategy.baseStakeU, runtimeState.run.currentStep) : null,
      nextStakeU: computeStake(strategy.baseStakeU, runtimeState.run.currentStep ?? 1),
      selected: true,
      recommended: selectedMeta?.recommended ?? false,
      recommendationReason: selectedMeta?.recommendationReason ?? "",
      walkForward: selectedMeta?.walkForward ?? null,
    };
  } catch {
    activeStrategy = null;
  }
  const pendingVersion = availableStrategies.find((entry) => entry.dir === activeStrategyDir)?.version ?? activeStrategy?.version ?? "";

  const state: AppUiState = {
    mode: "app_ui_state",
    generatedAt: nowIso(),
    configFile,
    configPresent,
    configValid,
    configIssues,
    overview: {
      profileName: config?.profileName ?? "unconfigured-profile",
      health: daemon.health,
      runnerStatus: daemon.runner?.status ?? "unknown",
      executeLive: config?.trading.executeLive ?? false,
      commitState: config?.trading.commitState ?? true,
      intervalMs: config?.trading.intervalMs ?? daemon.runner?.intervalMs ?? 60_000,
      runtimePaused: runtimeState.risk.paused,
      pauseCode: runtimeState.risk.pauseCode,
      activeOrderId: runtimeState.orders.lastOrderId,
      currentStep: runtimeState.run.currentStep,
      lastAction: runtimeState.run.lastAction,
    },
    controls: {
      canStart: configValid && (daemon.health === "never_started" || daemon.health === "stopped" || daemon.health === "error" || daemon.health === "stale"),
      canStop: daemon.health === "starting" || daemon.health === "running" || daemon.health === "sleeping" || daemon.health === "runtime_paused",
      canPause: !runtimeState.risk.paused && (daemon.health === "running" || daemon.health === "sleeping"),
      canResume: runtimeState.risk.paused,
      canViewLogs: true,
      canEditConfig: true,
    },
    pages: {
      dashboard: {
        cards: [],
        banners: [],
      },
      config: {
        summary: {
          profileName: configSummary.profileName,
          privateKeyMasked: configSummary.credentials.privateKeyMasked,
          walletAddress: configSummary.credentials.walletAddress,
          funderAddress: configSummary.credentials.funderAddress,
          signatureType: configSummary.credentials.signatureType,
          strategyDir: configSummary.trading.strategyDir,
          scheduledTaskName: configSummary.windows.scheduledTaskName,
        },
        network: configSummary.network,
        riskLimits: configSummary.riskLimits,
        paths: configSummary.paths,
      },
      strategy: {
        active: activeStrategy,
        available: availableStrategies,
        summary: {
          selectedVersion: activeStrategy?.version ?? "",
          recommendedVersion: recommendedStrategy?.version ?? "",
          candidateCount: availableStrategies.length,
          runningVersion,
          runningStrategyDir: runningStrategyMeta?.dir ?? "",
          pendingVersion,
          pendingStrategyDir: activeStrategyDir,
          switchRequiresRestart: Boolean(
            runningVersion &&
              pendingVersion &&
              runningVersion !== pendingVersion &&
              (daemon.health === "running" || daemon.health === "sleeping" || daemon.health === "runtime_paused"),
          ),
          sourceNote:
            "候选策略来自 strategy_outputs 目录；点击“全量重算并选优”会扫描全部 64 个 6位 U/D pattern，并在 10%~90% coverage 区间内选优。当前默认训练窗口约 334 天，页面候选列表默认只展示前 6 名。",
          strategyRoot,
        },
      },
      runtime: {
        daemon,
        session: runtimeState.session,
        run: runtimeState.run,
        orders: runtimeState.orders,
        trades: runtimeState.trades,
        positions: runtimeState.positions,
        account: runtimeState.account,
        redemption: runtimeState.redemption,
        risk: runtimeState.risk,
      },
      logs: {
        file: daemon.eventsLogFile,
        count: entries.length,
        entries,
      },
    },
  };

  state.pages.dashboard.banners = buildBanners({
    configPresent: state.configPresent,
    configValid: state.configValid,
    health: state.overview.health,
    pauseCode: runtimeState.risk.pauseCode,
    pauseReason: runtimeState.risk.pauseReason,
    lastError: daemon.runner?.lastError ?? "",
    issuesCount: state.configIssues.length,
  });
  state.pages.dashboard.cards = deriveCards(state);

  return state;
}
