export type SignatureType = 0 | 1 | 2 | 3;

export interface AppConfigValidationIssue {
  path: string;
  message: string;
}

export type DaemonHealthStatus =
  | "never_started"
  | "starting"
  | "running"
  | "sleeping"
  | "runtime_paused"
  | "stopped"
  | "error"
  | "stale";

export interface DaemonHeartbeatSnapshot {
  pid: number;
  status: "starting" | "running_tick" | "sleeping" | "stopped" | "error";
  execute: boolean;
  commitState: boolean;
  intervalMs: number;
  tickCount: number;
  startedAt: string;
  updatedAt: string;
  lastTickStartedAt: string;
  lastTickFinishedAt: string;
  lastSuccessfulTickAt: string;
  lastTickMode: string;
  lastError: string;
  nextWakeAt: string;
  runtimePaused: boolean;
  runtimePauseCode: string;
  runtimePauseReason: string;
  runtimeLastAction: string;
  runtimeCurrentStep: number | null;
  stateFile: string;
  eventsLogFile: string;
}

export interface DaemonStatusSnapshot {
  mode: "daemon_status";
  health: DaemonHealthStatus;
  staleAfterMs: number;
  heartbeatFile: string;
  stateFile: string;
  eventsLogFile: string;
  heartbeatPresent: boolean;
  heartbeatAgeMs: number | null;
  updatedAt: string;
  runner: {
    pid: number;
    status: DaemonHeartbeatSnapshot["status"];
    execute: boolean;
    commitState: boolean;
    intervalMs: number;
    tickCount: number;
    startedAt: string;
    lastTickStartedAt: string;
    lastTickFinishedAt: string;
    lastSuccessfulTickAt: string;
    lastTickMode: string;
    lastError: string;
    nextWakeAt: string;
  } | null;
  runtime: {
    paused: boolean;
    pauseCode: string;
    pauseReason: string;
    lastGuardDecision: string;
    inRun: boolean;
    currentStep: number | null;
    lastAction: string;
    lastReason: string;
    lastDirection: "U" | "D" | null;
    lastOrderId: string;
    lastOrderStatus: string;
    consecutiveApiFailures: number;
    consecutiveBlowups: number;
    dailyLossU: number;
  };
}

export interface AppUiBanner {
  level: "info" | "success" | "warning" | "error";
  code: string;
  title: string;
  detail: string;
  suggestedAction: string;
}

export interface AppUiLogEntry {
  timestamp: string;
  eventType: string;
  message: string;
  orderId?: string;
  tokenId?: string;
}

export interface AppUiState {
  mode: "app_ui_state";
  generatedAt: string;
  configFile: string;
  configPresent: boolean;
  configValid: boolean;
  configIssues: AppConfigValidationIssue[];
  overview: {
    profileName: string;
    health: DaemonHealthStatus;
    runnerStatus: DaemonHeartbeatSnapshot["status"] | "unknown";
    executeLive: boolean;
    commitState: boolean;
    intervalMs: number;
    runtimePaused: boolean;
    pauseCode: string;
    activeOrderId: string;
    currentStep: number | null;
    lastAction: string;
  };
  controls: {
    canStart: boolean;
    canStop: boolean;
    canPause: boolean;
    canResume: boolean;
    canViewLogs: boolean;
    canEditConfig: boolean;
  };
  pages: {
    dashboard: {
      cards: Array<{ key: string; label: string; value: string; tone: "neutral" | "good" | "warning" | "danger" }>;
      banners: AppUiBanner[];
    };
    config: {
      summary: {
        profileName: string;
        privateKeyMasked: string;
        walletAddress: string;
        funderAddress: string;
        signatureType: SignatureType;
        strategyDir: string;
        scheduledTaskName: string;
      };
      network: ExecutorAppConfig["network"];
      riskLimits: ExecutorAppConfig["riskLimits"];
      paths: ExecutorAppConfig["paths"];
    };
    strategy: {
      active: {
        version: string;
        generatedAtUtc: string;
        pattern: string;
        coverageTarget: number;
        trainWindowDays: number;
        stepDays: number;
        baseStakeU: number;
        maxSteps: number;
        allowedStatesCount: number;
        strategyDir: string;
        currentStep: number | null;
        currentStakeU: number | null;
        nextStakeU: number | null;
        selected: boolean;
        recommended: boolean;
        recommendationReason: string;
        walkForward: StrategyWalkForwardSummary | null;
      } | null;
      available: StrategyCatalogEntry[];
      summary: {
        selectedVersion: string;
        recommendedVersion: string;
        candidateCount: number;
        runningVersion: string;
        runningStrategyDir: string;
        pendingVersion: string;
        pendingStrategyDir: string;
        switchRequiresRestart: boolean;
        sourceNote: string;
        strategyRoot: string;
      };
    };
    runtime: {
      daemon: DaemonStatusSnapshot;
      session: RuntimeStateV2["session"];
      run: RuntimeStateV2["run"];
      orders: RuntimeStateV2["orders"];
      trades: RuntimeStateV2["trades"];
      positions: RuntimeStateV2["positions"];
      account: RuntimeStateV2["account"];
      redemption: RuntimeStateV2["redemption"];
      risk: RuntimeStateV2["risk"];
    };
    logs: {
      file: string;
      count: number;
      entries: AppUiLogEntry[];
    };
  };
}

export interface ExecutorAppConfig {
  version: 1;
  profileName: string;
  credentials: {
    privateKey: string;
    walletAddress: string;
    funderAddress: string;
    signatureType: SignatureType;
  };
  network: {
    host: string;
    chainId: number;
    rpcUrl: string;
    dataApiBaseUrl: string;
    gammaApiBaseUrl: string;
    binanceApiBaseUrl: string;
    binanceSymbol: string;
  };
  trading: {
    executeLive: boolean;
    commitState: boolean;
    intervalMs: number;
    strategyDir: string;
    baseStakeU: number;
  };
  redemption: {
    autoRedeemEnabled: boolean;
    relayerApiKey: string;
    relayerApiKeyAddress: string;
  };
  riskLimits: {
    maxDailyLossU: number;
    maxConsecutiveBlowups: number;
    maxApiFailures: number;
  };
  paths: {
    stateFile: string;
    eventsLogFile: string;
    heartbeatFile: string;
    daemonPidFile: string;
    daemonStdoutLogFile: string;
    daemonStderrLogFile: string;
    daemonStopFile: string;
  };
  windows: {
    scheduledTaskName: string;
    autoStartOnLogon: boolean;
    autoStartOnBoot: boolean;
  };
}

export interface ApiCreds {
  key: string;
  secret: string;
  passphrase: string;
}

export interface ExecutorConfig {
  host: string;
  chainId: number;
  rpcUrl: string;
  dataApiBaseUrl: string;
  gammaApiBaseUrl: string;
  strategyDir: string;
  baseStakeU: number;
  binanceApiBaseUrl: string;
  binanceSymbol: string;
  autoRedeemEnabled: boolean;
  relayerApiKey?: string;
  relayerApiKeyAddress?: `0x${string}`;
  maxDailyLossU: number;
  maxConsecutiveBlowups: number;
  maxApiFailures: number;
  privateKey?: `0x${string}`;
  walletAddress?: `0x${string}`;
  funderAddress?: `0x${string}`;
  signatureType: SignatureType;
  stateFile: string;
  eventsLogFile: string;
  heartbeatFile: string;
  daemonPidFile: string;
  daemonStdoutLogFile: string;
  daemonStderrLogFile: string;
  daemonStopFile: string;
}

export interface SessionContext {
  host: string;
  chainId: number;
  rpcUrl: string;
  walletAddress: `0x${string}`;
  funderAddress: `0x${string}`;
  signatureType: SignatureType;
  creds: ApiCreds;
  privateKeyPresent: boolean;
}

export interface AccountSnapshot {
  collateralBalance: string;
  allowance: string;
  timestamp: string;
  raw: unknown;
}

export interface OrderIntent {
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  amount: number;
  orderType: "GTC" | "FOK" | "FAK" | "GTD";
}

export interface OrderSnapshot {
  orderId: string;
  status: string;
  tokenId: string;
  side: string;
  price: string;
  originalSize: string;
  matchedSize: string;
  outcome: string;
  createdAt: string;
  raw: unknown;
}

export interface TradeSnapshot {
  tradeIds: string[];
  matchedOrderId: string;
  count: number;
  tokenIds: string[];
  latestPrice: number;
  latestSide: string;
  latestStatus: string;
  raw: unknown;
}

export interface PositionSnapshot {
  user: string;
  tokenId: string;
  size: number;
  side: string;
  entryPrice: number;
  count: number;
  raw: unknown;
}

export interface MarketOutcomeToken {
  outcome: string;
  tokenId: string;
  price: string;
}

export interface LocatedMarket {
  marketId: string;
  conditionId: string;
  slug: string;
  question: string;
  eventSlug: string;
  eventTitle: string;
  seriesSlug: string;
  acceptingOrders: boolean;
  active: boolean;
  closed: boolean;
  eventStartTime: string;
  endDate: string;
  orderMinSize: number;
  tickSize: number;
  negRisk: boolean;
  outcomes: MarketOutcomeToken[];
  raw: unknown;
}

export interface StrategyConfigBundle {
  version: string;
  generatedAtUtc: string;
  pattern: string;
  coverageTarget: number;
  riskHorizonH: number;
  trainWindowDays: number;
  stepDays: number;
  baseStakeU: number;
  maxSteps: number;
  allowedStatesCount: number;
}

export interface StrategyCatalogEntry {
  key: string;
  label: string;
  dir: string;
  version: string;
  generatedAtUtc: string;
  pattern: string;
  coverageTarget: number;
  riskHorizonH: number;
  trainWindowDays: number;
  stepDays: number;
  baseStakeU: number;
  maxSteps: number;
  allowedStatesCount: number;
  walkForward: StrategyWalkForwardSummary | null;
  recommendationScore: number;
  recommended: boolean;
  selected: boolean;
  recommendationReason: string;
}

export interface StrategyWalkForwardSummary {
  version: string;
  pattern: string;
  coverageTarget: number;
  nSteps: number;
  totalEntries: number;
  totalBlowups: number;
  totalPnlU: number;
  maxStepDrawdownU: number;
  avgEntriesPerStep: number;
  profitableSteps: number;
  losingSteps: number;
  stableSteps: number;
  latestAllowedStatesCount: number;
  avgTrainCoverage: number;
}

export interface AllowedStatesBundle {
  version: string;
  pattern: string;
  coverageTarget: number;
  allowedStates: Set<string>;
}

export interface CandleSnapshot {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyDecision {
  version: string;
  pattern: string;
  currentState: string;
  isAllowed: boolean;
  inRun: boolean;
  currentStep: number | null;
  nextStep: number | null;
  nextDirection: "U" | "D" | null;
  recommendedAction: "BLOCK" | "START_RUN" | `BET_STEP_${number}`;
  reason: string;
}

export interface RuntimeStateV2 {
  session: {
    walletAddress: string;
    funderAddress: string;
    signatureType: number;
    connected: boolean;
    updatedAt: string;
  };
  strategy: {
    strategyVersion: string;
    mode: string;
  };
  run: {
    inRun: boolean;
    currentStep: number | null;
    lastProcessedCandleOpenTimeMs: number | null;
    pendingDecisionCandleOpenTimeMs: number | null;
    lastState: string;
    lastAction: string;
    lastDirection: "U" | "D" | null;
    lastReason: string;
    pendingDecisionReason: string;
    pauseReason: string;
    updatedAt: string;
    totalRunsStarted: number;
    totalWins: number;
    totalLosses: number;
    totalBlowups: number;
  };
  orders: {
    activeOrderIds: string[];
    lastOrderId: string;
    lastOrderStatus: string;
    lastOrderTokenId: string;
    lastOrderSide: string;
    lastOrderPrice: number;
    lastOrderSize: number;
    updatedAt: string;
  };
  trades: {
    lastTradeIds: string[];
    lastMatchedOrderId: string;
    lastTradeCount: number;
    updatedAt: string;
  };
  positions: {
    lastPositionTokenId: string;
    lastPositionSize: number;
    lastPositionSide: string;
    updatedAt: string;
  };
  account: {
    lastCollateralBalance: string;
    lastAllowance: string;
    updatedAt: string;
  };
  redemption: {
    status:
      | "idle"
      | "pending_market_close"
      | "pending_position"
      | "submission_skipped"
      | "submitted"
      | "mined"
      | "failed";
    lastAttemptedTokenId: string;
    lastAttemptedConditionId: string;
    lastAttemptedMarketStartTime: string;
    lastSubmittedTokenId: string;
    lastSubmittedConditionId: string;
    lastTransactionId: string;
    lastTransactionHash: string;
    lastError: string;
    updatedAt: string;
  };
  risk: {
    paused: boolean;
    pauseCode: string;
    pauseReason: string;
    consecutiveBlowups: number;
    consecutiveApiFailures: number;
    dailyLossU: number;
    dailyLossDate: string;
    lastGuardDecision: string;
    updatedAt: string;
  };
}

export interface ExecutionEvent {
  timestamp: string;
  eventType: string;
  message: string;
  orderId?: string;
  tokenId?: string;
  payload?: unknown;
}

export interface ExecutionReconciliation {
  orderId: string;
  tokenId: string;
  orderStatus: string;
  orderFound: boolean;
  tradeCount: number;
  tradeIds: string[];
  tradeTokenIds: string[];
  latestTradePrice: number;
  latestTradeSide: string;
  latestTradeStatus: string;
  positionFound: boolean;
  positionSize: number;
  positionSide: string;
  positionEntryPrice: number;
  inferredStatus: "OPEN" | "MATCHED" | "FILLED_POSITION" | "MISSED" | "UNKNOWN" | "NO_EVIDENCE";
  raw: {
    order: unknown;
    trades: unknown;
    position: unknown;
  };
}
