import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { buildExecutorConfigFromAppConfig, loadAppConfig, makeDefaultAppConfig, summarizeAppConfig, validateAppConfig } from "./app_config.js";
import { getDaemonStatusSnapshot } from "./daemon_status.js";
import { loadExecutorConfig } from "./config.js";
import { loadRuntimeState } from "./state.js";
import { listStrategyCatalog, loadStrategyBundle } from "./strategy_loader.js";
import type { AppUiBanner, AppUiLogEntry, AppUiState, ExecutionEvent, StrategyCatalogEntry } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function buildAccountChecks(config: ReturnType<typeof loadAppConfig>, summary: ReturnType<typeof summarizeAppConfig>): AppUiBanner[] {
  const checks: AppUiBanner[] = [];
  const { account, credentials, redemption } = summary;
  const signerAddress = /^0x[a-fA-F0-9]{64}$/.test(config.credentials.privateKey)
    ? privateKeyToAccount(config.credentials.privateKey as `0x${string}`).address
    : "";

  checks.push({
    level:
      signerAddress && signerAddress.toLowerCase() === credentials.walletAddress.toLowerCase() ? "success" : "error",
    code: "SIGNER_WALLET_MATCH",
    title:
      signerAddress && signerAddress.toLowerCase() === credentials.walletAddress.toLowerCase()
        ? "私钥与 signer 地址匹配"
        : "私钥与 walletAddress 不匹配",
    detail:
      signerAddress && signerAddress.toLowerCase() === credentials.walletAddress.toLowerCase()
        ? "当前 privateKey 推导出的 signer 地址与 walletAddress 一致。"
        : signerAddress
          ? `当前 privateKey 实际推导出的 signer 地址是 ${signerAddress}，但配置里的 walletAddress 是 ${credentials.walletAddress}。这会导致余额读取、鉴权或真实下单异常。`
          : "当前 privateKey 格式无效，无法推导 signer 地址。请先修正私钥格式，再继续验证。",
    suggestedAction:
      signerAddress && signerAddress.toLowerCase() === credentials.walletAddress.toLowerCase()
        ? "保持当前 signer 配置即可。"
        : signerAddress
          ? "请把 walletAddress 改成导出私钥对应的 signer 地址，或重新填入与当前 walletAddress 对应的正确私钥。"
          : "请填入 0x 开头的 64 位私钥，并确认它对应当前 signer 地址。",
  });

  if (account.accountMode === "eoa") {
    checks.push({
      level: credentials.signatureType === 0 ? "success" : "error",
      code: "EOA_SIGNATURE_TYPE",
      title: credentials.signatureType === 0 ? "EOA 签名类型正确" : "EOA 签名类型不匹配",
      detail:
        credentials.signatureType === 0
          ? "当前 EOA 模式使用 signatureType=0，符合老系统钱包模式。"
          : `当前 EOA 模式却配置了 signatureType=${credentials.signatureType}，这通常会导致鉴权失败。`,
      suggestedAction:
        credentials.signatureType === 0 ? "保持当前设置即可。" : "把签名类型改回 0，并重新保存配置。",
    });
    checks.push({
      level:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() === credentials.funderAddress.toLowerCase()
          ? "success"
          : "warning",
      code: "EOA_FUNDER_MATCH",
      title:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() === credentials.funderAddress.toLowerCase()
          ? "EOA 地址关系正常"
          : "EOA funder 与钱包地址不一致",
      detail:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() === credentials.funderAddress.toLowerCase()
          ? "EOA 模式下，walletAddress 与 funderAddress 当前一致。"
          : "EOA 模式下通常 walletAddress 与 funderAddress 应该填写同一个外部钱包地址。",
      suggestedAction:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() === credentials.funderAddress.toLowerCase()
          ? "如果这是您当前老系统的钱包模式，可继续使用。"
          : "如果您不是在做特殊实验，请把 funderAddress 改成与钱包地址一致。",
    });
  } else if (account.accountMode === "poly_proxy") {
    checks.push({
      level: credentials.signatureType === 1 ? "success" : "error",
      code: "PROXY_SIGNATURE_TYPE",
      title: credentials.signatureType === 1 ? "POLY_PROXY 签名类型正确" : "POLY_PROXY 签名类型不匹配",
      detail:
        credentials.signatureType === 1
          ? "当前邮箱账户模式使用 signatureType=1，符合官方 POLY_PROXY 路径。"
          : `当前 POLY_PROXY 模式却配置了 signatureType=${credentials.signatureType}，这通常无法通过 Polymarket 账户鉴权。`,
      suggestedAction:
        credentials.signatureType === 1 ? "保持当前设置，然后继续核对 signer 与 proxy funder。" : "把签名类型改成 1，并重新保存配置。",
    });
    checks.push({
      level:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
          ? "success"
          : "warning",
      code: "PROXY_FUNDER_RELATION",
      title:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
          ? "POLY_PROXY 地址关系看起来合理"
          : "POLY_PROXY 的 signer / funder 关系需要确认",
      detail:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
          ? "当前 walletAddress 与 funderAddress 不相同，更接近 signer 地址 + 站内 proxy wallet 的常见填写方式。"
          : "POLY_PROXY 模式下，walletAddress 通常是 signer 地址，而 funderAddress 通常是站内 proxy wallet，二者往往不相同。",
      suggestedAction:
        credentials.walletAddress &&
        credentials.funderAddress &&
        credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
          ? "下一步建议用测试邮箱账户做只读校验和小额下单。"
          : "请从 Polymarket 站内确认 proxy wallet 地址，并把它单独填入 funderAddress。",
    });
  } else {
    checks.push({
      level: credentials.signatureType === 3 ? "success" : "error",
      code: "DEPOSIT_WALLET_SIGNATURE_TYPE",
      title: credentials.signatureType === 3 ? "Deposit Wallet 签名类型正确" : "Deposit Wallet 签名类型不匹配",
      detail:
        credentials.signatureType === 3
          ? "当前邮箱账户新模式使用 signatureType=3，符合官方 POLY_1271 路径。"
          : `当前 deposit wallet 模式却配置了 signatureType=${credentials.signatureType}，这通常会被 CLOB 拒绝并提示使用 deposit wallet flow。`,
      suggestedAction:
        credentials.signatureType === 3 ? "保持当前设置，然后继续核对 signer 与 deposit wallet。" : "把签名类型改成 3，并重新保存配置。",
    });
    checks.push({
      level:
        !credentials.funderAddress ||
        credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
          ? "success"
          : "warning",
      code: "DEPOSIT_WALLET_FUNDER_RELATION",
      title:
        !credentials.funderAddress
          ? "Deposit Wallet 将自动推导"
          : credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
            ? "Deposit Wallet 地址关系看起来合理"
            : "Deposit Wallet 地址关系需要确认",
      detail:
        !credentials.funderAddress
          ? "当前未显式填写 funderAddress，系统会根据 signer 地址自动推导 deposit wallet。"
          : credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
            ? "当前 walletAddress 与 funderAddress 不相同，更接近 signer 地址 + deposit wallet 的常见填写方式。"
            : "Deposit wallet 模式下，walletAddress 通常是 signer 地址，而 funderAddress 通常是 deposit wallet 地址，二者通常不相同。",
      suggestedAction:
        !credentials.funderAddress
          ? "可以先执行只读验证，让系统返回推导出的 deposit wallet 结果。"
          : credentials.walletAddress.toLowerCase() !== credentials.funderAddress.toLowerCase()
            ? "下一步建议同步余额，再用小额测试单验证 deposit wallet flow。"
            : "请确认 funderAddress 填的是 deposit wallet，而不是 signer 地址本身。",
    });
  }

  if (redemption.autoRedeemEnabled && !redemption.relayerApiKeyAddress) {
    checks.push({
      level: "warning",
      code: "REDEEM_RELAYER_MISSING",
      title: "自动回款凭据未补全",
      detail: "当前自动回款开关已开启，但还没有完整填写 Relayer API Key Address。",
      suggestedAction: "如果暂时不做自动回款，可先关闭该开关；否则请补齐 relayer 凭据。",
    });
  }

  return checks;
}

function getStrategySourceKind(version: string): StrategyCatalogEntry["sourceKind"] {
  if (version.startsWith("auto-")) {
    return "auto";
  }
  if (version.startsWith("temp-")) {
    return "temp";
  }
  return "other";
}

function buildLiveCandidateMeta(entry: StrategyCatalogEntry): Pick<StrategyCatalogEntry, "liveEligible" | "liveRecommended" | "sourceKind" | "liveRecommendationReason"> {
  const sourceKind = getStrategySourceKind(entry.version);
  const walk = entry.walkForward;
  if (!walk) {
    return {
      liveEligible: false,
      liveRecommended: false,
      sourceKind,
      liveRecommendationReason: "缺少 walk-forward 摘要，暂不进入实盘候选。",
    };
  }
  if (walk.totalBlowups !== 0) {
    return {
      liveEligible: false,
      liveRecommended: false,
      sourceKind,
      liveRecommendationReason: `样本外爆仓 ${walk.totalBlowups} 次，当前不进入实盘候选。`,
    };
  }
  if (walk.nSteps < 3) {
    return {
      liveEligible: false,
      liveRecommended: false,
      sourceKind,
      liveRecommendationReason: `walk-forward 仅 ${walk.nSteps} 步，样本外分段太少，当前只建议研究参考。`,
    };
  }
  if (walk.totalPnlU <= 0) {
    return {
      liveEligible: false,
      liveRecommended: false,
      sourceKind,
      liveRecommendationReason: `样本外总收益 ${walk.totalPnlU.toFixed(2)}U，未达到正收益门槛。`,
    };
  }
  return {
    liveEligible: true,
    liveRecommended: false,
    sourceKind,
    liveRecommendationReason:
      sourceKind === "auto"
        ? "满足当前实盘门槛：blowup=0、walk-forward 步数>=3、样本外总收益为正，且属于正式 auto 候选。"
        : "满足当前实盘门槛，但来源于临时研究目录；若要正式实盘，建议后续转成 auto 正式候选。",
  };
}

function compareLiveCandidates(a: StrategyCatalogEntry, b: StrategyCatalogEntry): number {
  const sourceRank = (entry: StrategyCatalogEntry): number => {
    if (entry.sourceKind === "auto") {
      return 0;
    }
    if (entry.sourceKind === "temp") {
      return 1;
    }
    return 2;
  };
  const sourceDiff = sourceRank(a) - sourceRank(b);
  if (sourceDiff !== 0) {
    return sourceDiff;
  }
  const scoreDiff = Number(b.recommendationScore || Number.NEGATIVE_INFINITY) - Number(a.recommendationScore || Number.NEGATIVE_INFINITY);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return (b.walkForward?.totalPnlU ?? Number.NEGATIVE_INFINITY) - (a.walkForward?.totalPnlU ?? Number.NEGATIVE_INFINITY);
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
  const availableStrategies = listStrategyCatalog(strategyRoot).map((entry) => {
    const liveMeta = buildLiveCandidateMeta(entry);
    return {
      ...entry,
      ...liveMeta,
      selected: entry.dir === activeStrategyDir,
    };
  });
  const recommendedStrategy = availableStrategies.find((entry) => entry.recommended) ?? null;
  const liveRecommendedStrategy =
    availableStrategies
      .filter((entry) => entry.liveEligible)
      .sort(compareLiveCandidates)[0] ?? null;
  const hydratedStrategies = availableStrategies.map((entry) => ({
    ...entry,
    liveRecommended: liveRecommendedStrategy ? entry.dir === liveRecommendedStrategy.dir : false,
  }));
  const runningVersion = runtimeState.strategy.strategyVersion || "";
  const runningStrategyMeta =
    hydratedStrategies.find((entry) => entry.version === runningVersion) ??
    hydratedStrategies.find((entry) => entry.dir === activeStrategyDir) ??
    null;
  let activeStrategy: AppUiState["pages"]["strategy"]["active"] = null;
  try {
    const { strategy } = loadStrategyBundle(activeStrategyDir, {
      baseStakeUOverride: config?.trading.baseStakeU ?? executorConfig.baseStakeU,
    });
    const selectedMeta = hydratedStrategies.find((entry) => entry.dir === activeStrategyDir) ?? null;
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
  const pendingVersion = hydratedStrategies.find((entry) => entry.dir === activeStrategyDir)?.version ?? activeStrategy?.version ?? "";

  const state: AppUiState = {
    mode: "app_ui_state",
    generatedAt: nowIso(),
    configFile,
    configPresent,
    configValid,
    configIssues,
    overview: {
      profileName: config?.profileName ?? "unconfigured-profile",
      accountMode: config?.account.accountMode ?? "eoa",
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
          accountMode: configSummary.account.accountMode,
          accountLabel: configSummary.account.label,
          accountNotes: configSummary.account.notes,
          modeHint: configSummary.accountModeHint,
          privateKeyMasked: configSummary.credentials.privateKeyMasked,
          walletAddress: configSummary.credentials.walletAddress,
          funderAddress: configSummary.credentials.funderAddress,
          signatureType: configSummary.credentials.signatureType,
          strategyDir: configSummary.trading.strategyDir,
          scheduledTaskName: configSummary.windows.scheduledTaskName,
        },
        accountChecks: config ? buildAccountChecks(config, configSummary) : [],
        network: configSummary.network,
        riskLimits: configSummary.riskLimits,
        paths: configSummary.paths,
      },
      strategy: {
        active: activeStrategy,
        available: hydratedStrategies,
        summary: {
          selectedVersion: activeStrategy?.version ?? "",
          recommendedVersion: recommendedStrategy?.version ?? "",
          liveRecommendedVersion: liveRecommendedStrategy?.version ?? "",
          candidateCount: hydratedStrategies.length,
          liveEligibleCount: hydratedStrategies.filter((entry) => entry.liveEligible).length,
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
