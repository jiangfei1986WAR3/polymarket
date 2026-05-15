const refreshButton = document.querySelector("#refresh-button");
const generatedAt = document.querySelector("#generated-at");
const statusLine = document.querySelector("#status-line");
const bannerList = document.querySelector("#banner-list");
const cardGrid = document.querySelector("#card-grid");
const issueList = document.querySelector("#issue-list");
const actionOutput = document.querySelector("#action-output");
const configPath = document.querySelector("#config-path");
const runtimeSummary = document.querySelector("#runtime-summary");
const logMeta = document.querySelector("#log-meta");
const logList = document.querySelector("#log-list");
const pathList = document.querySelector("#path-list");
const heroGrid = document.querySelector("#hero-grid");
const strategyProgress = document.querySelector("#strategy-progress");
const strategyProgressTitle = document.querySelector("#strategy-progress-title");
const strategyProgressPercent = document.querySelector("#strategy-progress-percent");
const strategyProgressBar = document.querySelector("#strategy-progress-bar");
const strategyProgressDetail = document.querySelector("#strategy-progress-detail");
const strategyCenterSummary = document.querySelector("#strategy-center-summary");
const strategySourceNote = document.querySelector("#strategy-source-note");
const strategyCardGrid = document.querySelector("#strategy-card-grid");
const strategyDetailList = document.querySelector("#strategy-detail-list");
const strategyNotice = document.querySelector("#strategy-notice");
const martingaleLadder = document.querySelector("#martingale-ladder");
const candidateStrategyList = document.querySelector("#candidate-strategy-list");
const strategyReloadButton = document.querySelector("#reload-strategy-button");
const autoPickStrategyButton = document.querySelector("#auto-pick-strategy-button");
const applyStrategyButton = document.querySelector("#apply-strategy-button");
const loadConfigButton = document.querySelector("#load-config-button");
const saveConfigButton = document.querySelector("#save-config-button");
const openConfigDirButton = document.querySelector("#open-config-dir-button");
const openLogsDirButton = document.querySelector("#open-logs-dir-button");
const openStrategyDirButton = document.querySelector("#open-strategy-dir-button");
const form = {
  profileName: document.querySelector("#profile-name"),
  privateKey: document.querySelector("#private-key"),
  walletAddress: document.querySelector("#wallet-address"),
  funderAddress: document.querySelector("#funder-address"),
  signatureType: document.querySelector("#signature-type"),
  executeLive: document.querySelector("#execute-live"),
  commitState: document.querySelector("#commit-state"),
  intervalMs: document.querySelector("#interval-ms"),
  baseStakeU: document.querySelector("#base-stake-u"),
  autoRedeemEnabled: document.querySelector("#auto-redeem-enabled"),
  relayerApiKey: document.querySelector("#relayer-api-key"),
  relayerApiKeyAddress: document.querySelector("#relayer-api-key-address"),
  strategySelect: document.querySelector("#strategy-select"),
  maxDailyLossU: document.querySelector("#max-daily-loss-u"),
  maxConsecutiveBlowups: document.querySelector("#max-consecutive-blowups"),
  maxApiFailures: document.querySelector("#max-api-failures"),
  host: document.querySelector("#host"),
  rpcUrl: document.querySelector("#rpc-url"),
  binanceSymbol: document.querySelector("#binance-symbol"),
  chainId: document.querySelector("#chain-id"),
  dataApiBaseUrl: document.querySelector("#data-api-base-url"),
  gammaApiBaseUrl: document.querySelector("#gamma-api-base-url"),
  binanceApiBaseUrl: document.querySelector("#binance-api-base-url"),
  scheduledTaskName: document.querySelector("#scheduled-task-name"),
};
const controlButtons = {
  start: document.querySelector("#start-button"),
  stop: document.querySelector("#stop-button"),
  restart: document.querySelector("#restart-button"),
  pause: document.querySelector("#pause-button"),
  resume: document.querySelector("#resume-button"),
};

let latestState = null;
let latestConfig = null;
let latestStrategyOptions = [];
let strategyProgressValue = 0;

function boolFromSelect(value) {
  return value === "true";
}

function numberFromInput(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function computeStake(baseStakeU, step) {
  const resolvedStep = step ?? 1;
  if (!Number.isFinite(baseStakeU) || baseStakeU <= 0 || !Number.isFinite(resolvedStep) || resolvedStep <= 0) {
    return null;
  }
  return Number((baseStakeU * 2 ** (resolvedStep - 1)).toFixed(8));
}

function friendlyHealth(value) {
  const map = {
    never_started: "未启动",
    starting: "启动中",
    running: "运行中",
    sleeping: "等待下一轮",
    runtime_paused: "已暂停",
    stopped: "已停止",
    error: "运行报错",
    stale: "心跳超时",
  };
  return map[value] || value;
}

function friendlyRunnerStatus(value) {
  const map = {
    starting: "启动中",
    running: "运行中",
    sleeping: "等待中",
    stopped: "已停止",
    error: "错误",
    unknown: "未知",
  };
  return map[value] || value;
}

function friendlyAction(value) {
  const map = {
    idle: "空闲",
    none: "无",
    paused: "已暂停",
    resumed: "已恢复",
    place_order: "下单",
    cancel_order: "撤单",
    reconcile: "对账",
  };
  return map[value] || value || "无";
}

function friendlyMode(isLive) {
  return isLive ? "真实运行" : "模拟运行";
}

function friendlyEventType(value) {
  const map = {
    ORDER_PLACED: "已下单",
    ORDER_MATCHED: "已成交",
    ORDER_CANCELLED: "已撤单",
    RUN_STARTED: "新一轮开始",
    RUN_STEP_ADVANCED: "进入下一步",
    RUN_WON: "本轮获胜",
    RUN_LOST: "本轮失败",
    RISK_PAUSED: "风控暂停",
    RUNTIME_RESUMED: "恢复运行",
    HEARTBEAT: "心跳更新",
  };
  return map[value] || value;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function setStrategyProgress(value, title, detail, tone = "working") {
  strategyProgressValue = Math.max(0, Math.min(100, value));
  strategyProgress.classList.remove("hidden", "success", "error");
  if (tone === "success") {
    strategyProgress.classList.add("success");
  } else if (tone === "error") {
    strategyProgress.classList.add("error");
  }
  strategyProgressTitle.textContent = title;
  strategyProgressPercent.textContent = `${Math.round(strategyProgressValue)}%`;
  strategyProgressBar.style.width = `${strategyProgressValue}%`;
  strategyProgressDetail.textContent = detail;
}

function startStrategyProgress() {
  setStrategyProgress(6, "正在准备全量重算并选优...", "系统正在整理 pattern 列表、coverage 区间，随后会读取本地 BTC 1H 数据并启动研究脚本。");
}

function finishStrategyProgress(resultCount) {
  setStrategyProgress(
    100,
    "全量重算并选优完成",
    `已生成 ${resultCount} 套自动候选策略，页面正在使用最新结果刷新推荐状态。`,
    "success",
  );
  window.setTimeout(() => {
    strategyProgress.classList.add("hidden");
  }, 2500);
}

function failStrategyProgress(message) {
  setStrategyProgress(100, "全量重算并选优失败", message, "error");
}

function renderStrategyJobProgress(job) {
  const currentLabel = job.currentVersion || job.currentKey || "准备中";
  const total = Number(job.total || 0);
  const completed = Number(job.completed || 0);
  const detail =
    total > 0
      ? `${job.detail}\n当前进度：${completed}/${total}；当前对象：${currentLabel}`
      : job.detail || "正在准备任务...";
  setStrategyProgress(job.progressPercent ?? 0, job.stage || "全量扫描中", detail);
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pollStrategyRescanJob(jobId) {
  while (true) {
    const payload = await fetchJson(`/api/strategy/rescan/status?jobId=${encodeURIComponent(jobId)}`);
    const job = payload.job;
    renderStrategyJobProgress(job);
    if (job.status === "done") {
      if (payload.state) {
        renderState(payload.state);
      } else {
        await refreshState();
      }
      finishStrategyProgress(job.results?.length || job.completed || 0);
      actionOutput.textContent =
        `全量重算并选优完成\n已生成 ${job.results?.length || job.completed || 0} 套自动候选策略。\n最新推荐结果已经刷新到页面。`;
      return;
    }
    if (job.status === "error") {
      failStrategyProgress(job.error || job.detail || "未知错误");
      actionOutput.textContent = `全量重算并选优失败\n${job.error || job.detail || "未知错误"}`;
      return;
    }
    await wait(900);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || formatJson(payload));
  }
  return payload;
}

function renderStatusCards(cards, container) {
  container.innerHTML = "";
  for (const card of cards) {
    const div = document.createElement("div");
    div.className = `status-card ${card.tone}`;
    div.innerHTML =
      `<div class="status-label">${card.label}</div>` +
      `<div class="status-value">${card.value}</div>`;
    container.appendChild(div);
  }
}

function renderHeroCards(cards) {
  heroGrid.innerHTML = "";
  for (const card of cards) {
    const div = document.createElement("div");
    div.className = "hero-card";
    div.innerHTML =
      `<div class="hero-title">${card.title}</div>` +
      `<div class="hero-value">${card.value}</div>` +
      `<div class="hero-detail">${card.detail}</div>`;
    heroGrid.appendChild(div);
  }
}

function renderDetailList(container, entries) {
  container.innerHTML = "";
  for (const entry of entries) {
    const div = document.createElement("div");
    div.className = "path-entry";
    div.innerHTML =
      `<div class="path-label">${entry.label}</div>` +
      `<div class="path-value">${entry.value}</div>` +
      (entry.extra ? `<div class="path-state">${entry.extra}</div>` : "");
    container.appendChild(div);
  }
}

function renderBanners(banners) {
  bannerList.innerHTML = "";
  if (!banners.length) {
    return;
  }
  for (const banner of banners) {
    const div = document.createElement("div");
    div.className = `banner ${banner.level}`;
    div.innerHTML =
      `<strong>${banner.title}</strong>` +
      `<div>${banner.detail}</div>` +
      `<div>${banner.suggestedAction}</div>`;
    bannerList.appendChild(div);
  }
}

function renderIssues(issues) {
  issueList.innerHTML = "";
  if (!issues || !issues.length) {
    return;
  }
  const title = document.createElement("div");
  title.className = "issue-title";
  title.textContent = "当前配置还有这些问题，修复后再启动更稳妥：";
  issueList.appendChild(title);
  for (const issue of issues) {
    const div = document.createElement("div");
    div.className = "issue-item";
    div.textContent = `${issue.path}：${issue.message}`;
    issueList.appendChild(div);
  }
}

function renderLogs(logs) {
  logMeta.textContent = `${logs.count} 条 | ${logs.file}`;
  logList.innerHTML = "";
  for (const entry of logs.entries) {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML =
      `<div class="log-meta">${entry.timestamp || "-"} | ${friendlyEventType(entry.eventType)}</div>` +
      `<div>${entry.message}</div>`;
    logList.appendChild(div);
  }
}

function renderRuntime(runtime) {
  runtimeSummary.textContent = formatJson({
    daemon: runtime.daemon,
    session: runtime.session,
    run: runtime.run,
    orders: runtime.orders,
    redemption: runtime.redemption,
    risk: runtime.risk,
  });
}

function renderPaths(entries) {
  renderDetailList(
    pathList,
    entries.map((entry) => ({
      label: entry.label,
      value: entry.path,
      extra: entry.exists ? "已存在" : "当前不存在",
    })),
  );
}

function syncStrategySelection() {
  if (!latestConfig) {
    return;
  }
  const selectedDir = latestConfig.trading.strategyDir || "";
  if ([...form.strategySelect.options].some((option) => option.value === selectedDir)) {
    form.strategySelect.value = selectedDir;
  }
}

function renderStrategyOptions(options) {
  latestStrategyOptions = options || [];
  const currentValue = form.strategySelect.value;
  form.strategySelect.innerHTML = "";

  if (!latestStrategyOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未找到可用策略";
    form.strategySelect.appendChild(option);
    return;
  }

  for (const entry of latestStrategyOptions) {
    const option = document.createElement("option");
    option.value = entry.dir;
    option.textContent = `${entry.label} | ${entry.pattern}`;
    form.strategySelect.appendChild(option);
  }

  if ([...form.strategySelect.options].some((option) => option.value === currentValue)) {
    form.strategySelect.value = currentValue;
  } else {
    syncStrategySelection();
  }
}

function getSelectedStrategyMeta() {
  return latestStrategyOptions.find((entry) => entry.dir === form.strategySelect.value) || null;
}

function pickRecommendedStrategy() {
  return latestStrategyOptions.find((entry) => entry.recommended) || null;
}

function sortCandidatesForDisplay(entries) {
  return [...(entries || [])].sort((a, b) => {
    if (a.recommended !== b.recommended) {
      return a.recommended ? -1 : 1;
    }
    if (a.selected !== b.selected) {
      return a.selected ? -1 : 1;
    }
    return Number(b.recommendationScore || Number.NEGATIVE_INFINITY) - Number(a.recommendationScore || Number.NEGATIVE_INFINITY);
  });
}

function renderStrategyCenterSummary(strategyPage) {
  const summary = strategyPage.summary;
  const referenceStrategy = (strategyPage.available || []).find((entry) => entry.recommended) || strategyPage.available?.[0] || null;
  const visibleCount = Math.min((strategyPage.available || []).length, 6);
  strategyCenterSummary.textContent =
    `当前已读取 ${summary.candidateCount} 套候选策略；当前运行中：${summary.runningVersion || "尚未运行"}；` +
    `下次生效：${summary.pendingVersion || summary.selectedVersion || "未识别"}；系统推荐：${summary.recommendedVersion || "暂无推荐"}；页面当前展示前 ${visibleCount} 名候选。`;
  renderDetailList(strategySourceNote, [
    { label: "候选策略目录", value: summary.strategyRoot || "-" },
    { label: "候选策略来源", value: summary.sourceNote || "当前暂无来源说明" },
    {
      label: "这些指标怎么看",
      value: "样本外总收益、总爆仓次数、最大回撤，都是 walk-forward 样本外测试阶段的历史统计，不等于未来年化收益，也不等于未来实盘回撤上限。",
      extra: referenceStrategy
        ? `当前候选默认按近 1 年 BTC 1H 数据研究；单步样本外按 ${referenceStrategy.stepDays} 天滚动。若 walk-forward 步数是 1，表示这次只形成了 1 段样本外测试，不是只测了 1 天。`
        : "walk-forward 步数越多，说明样本外分段越多，参考性通常更强。",
    },
    {
      label: "切换状态",
      value: summary.switchRequiresRestart ? "当前守护进程仍在运行旧策略" : "当前运行中策略和待生效策略一致",
      extra: summary.switchRequiresRestart ? "请先停止并重新启动，新的策略配置才会真正生效" : "无需额外重启",
    },
  ]);
}

function renderCandidateMetric(label, value, note) {
  return (
    `<div class="candidate-metric">` +
    `<div class="candidate-metric-label">${label}</div>` +
    `<div class="candidate-metric-value">${value}</div>` +
    `<div class="candidate-metric-note">${note}</div>` +
    `</div>`
  );
}

function renderCandidateStrategies(strategyPage) {
  candidateStrategyList.innerHTML = "";
  const rankedEntries = sortCandidatesForDisplay(strategyPage.available || []);
  const displayEntries = rankedEntries.slice(0, 6);
  for (const entry of displayEntries) {
    const div = document.createElement("div");
    div.className = `candidate-card${entry.selected ? " selected" : ""}${entry.recommended ? " recommended" : ""}`;
    const walkForward = entry.walkForward;
    const walkForwardStepNote = walkForward
      ? `本次样本外一共切成 ${walkForward.nSteps} 段；每段按 ${entry.stepDays} 天滚动，步数越多参考性越强。`
      : "当前缺少 walk-forward 摘要，所以还看不出样本外分成了几段。";
    div.innerHTML =
      `<div class="candidate-head">` +
      `<div>` +
      `<div class="candidate-title">${entry.label}</div>` +
      `<div class="candidate-description">${entry.recommendationReason}</div>` +
      `</div>` +
      `<div class="candidate-tags">` +
      `${entry.selected ? '<span class="candidate-tag info">当前启用</span>' : ""}` +
      `${entry.recommended ? '<span class="candidate-tag good">系统推荐</span>' : ""}` +
      `<span class="candidate-tag">coverage ${formatPercent(entry.coverageTarget)}</span>` +
      `<span class="candidate-tag">${entry.pattern}</span>` +
      `</div>` +
      `</div>` +
      `<div class="candidate-metrics">` +
      renderCandidateMetric("样本外总收益", walkForward ? `${walkForward.totalPnlU.toFixed(2)} U` : "-", "训练完成后，在样本外测试区间累计得到的模拟收益，不等于未来年化收益。") +
      renderCandidateMetric("总爆仓次数", walkForward ? walkForward.totalBlowups : "-", "样本外测试里，马丁一路打到最大步数仍未回本的次数；越少越稳。") +
      renderCandidateMetric("最大回撤", walkForward ? `${walkForward.maxStepDrawdownU.toFixed(2)} U` : "-", "样本外测试期间出现过的最大历史回撤，不是未来实盘回撤上限。") +
      renderCandidateMetric("allowed_states", entry.allowedStatesCount, "允许开新一轮马丁的状态数量；越多通常意味着触发更频繁。") +
      `</div>` +
      `<div class="candidate-metrics">` +
      renderCandidateMetric("walk-forward 步数", walkForward ? walkForward.nSteps : "-", walkForwardStepNote) +
      renderCandidateMetric("盈利周数", walkForward ? walkForward.profitableSteps : "-", "样本外分段里最终赚钱的段数；它和总收益要一起看，不能单独代表好坏。") +
      renderCandidateMetric("亏损周数", walkForward ? walkForward.losingSteps : "-", "样本外分段里最终亏钱的段数；如果很多，说明稳定性还不够。") +
      renderCandidateMetric("平均训练覆盖率", walkForward ? formatPercent(walkForward.avgTrainCoverage) : "-", `每轮训练阶段实际筛出的 coverage 平均值；当前这套策略的目标 coverage 是 ${formatPercent(entry.coverageTarget)}。`) +
      `</div>` +
      `<div class="candidate-actions">` +
      `<button type="button" data-action="select-candidate" data-dir="${entry.dir}">${entry.selected ? "当前已启用" : "设为当前策略"}</button>` +
      `</div>`;
    candidateStrategyList.appendChild(div);
  }

  if (rankedEntries.length > displayEntries.length) {
    const notice = document.createElement("div");
    notice.className = "info-strip";
    notice.textContent = `本次共得到 ${rankedEntries.length} 套候选策略，页面默认只展示前 6 名；完整候选仍保留在下拉框和本地策略目录中。`;
    candidateStrategyList.appendChild(notice);
  }
}

function renderStrategyPanel() {
  const selected = getSelectedStrategyMeta();
  const active = latestState?.pages?.strategy?.active || null;
  const baseStakeU = numberFromInput(form.baseStakeU.value, active?.baseStakeU ?? selected?.baseStakeU ?? 2);
  const currentStep = active?.currentStep ?? null;
  const currentStakeU = currentStep ? computeStake(baseStakeU, currentStep) : null;
  const nextStakeU = computeStake(baseStakeU, currentStep ?? 1);
  const preview = selected
    ? {
        ...selected,
        baseStakeU,
        currentStep,
        currentStakeU,
        nextStakeU,
      }
    : active
      ? {
          label: active.version || "当前策略",
          dir: active.strategyDir,
          version: active.version,
          generatedAtUtc: active.generatedAtUtc,
          pattern: active.pattern,
          coverageTarget: active.coverageTarget,
          trainWindowDays: active.trainWindowDays,
          stepDays: active.stepDays,
          baseStakeU,
          maxSteps: active.maxSteps,
          allowedStatesCount: active.allowedStatesCount,
          currentStep,
          currentStakeU,
          nextStakeU,
        }
      : null;

  if (!preview) {
    strategyCardGrid.innerHTML = "";
    strategyDetailList.innerHTML = "";
    return;
  }

  renderStatusCards(
    [
      { label: "策略版本", value: preview.version || "未知", tone: "neutral" },
      { label: "策略形态", value: preview.pattern || "未知", tone: "warning" },
      { label: "允许状态数", value: String(preview.allowedStatesCount ?? 0), tone: "neutral" },
      { label: "覆盖目标", value: String(preview.coverageTarget ?? 0), tone: "neutral" },
      { label: "初始马丁金额", value: `${baseStakeU} U`, tone: "warning" },
      { label: "最大步数", value: String(preview.maxSteps ?? 0), tone: "neutral" },
      { label: "当前马丁步数", value: currentStep === null ? "未开新轮" : `第 ${currentStep} 步`, tone: currentStep === null ? "neutral" : "warning" },
      { label: "当前应下注金额", value: currentStakeU === null ? `${nextStakeU ?? baseStakeU} U` : `${currentStakeU} U`, tone: "good" },
      { label: "下一步金额", value: `${nextStakeU ?? baseStakeU} U`, tone: "good" },
    ],
    strategyCardGrid,
  );

  const activeDir = active?.strategyDir || "";
  const selectedDir = selected?.dir || form.strategySelect.value || "";
  const strategyChanged = Boolean(activeDir && selectedDir && activeDir !== selectedDir);
  strategyNotice.textContent = strategyChanged
    ? `您当前选择的是新策略，尚未保存。现在运行中的仍然是 ${latestState?.pages?.strategy?.summary?.runningVersion || active?.version || "当前策略"}，点击“设为当前策略并保存”后，下次启动会切到 ${selected?.label || "所选策略"}。`
    : `当前运行模式为${friendlyMode(latestState?.overview?.executeLive)}。您现在设置的首步金额是 ${baseStakeU}U，系统后续会按马丁逻辑自动翻倍。`;

  martingaleLadder.innerHTML = "";
  const maxSteps = Math.max(1, Number(preview.maxSteps ?? 1));
  for (let step = 1; step <= maxSteps; step += 1) {
    const amount = computeStake(baseStakeU, step);
    const div = document.createElement("div");
    const toneClass =
      currentStep === step ? "current" : currentStep === null && step === 1 ? "next" : currentStep !== null && step === currentStep + 1 ? "next" : "";
    div.className = `ladder-card ${toneClass}`.trim();
    div.innerHTML =
      `<div class="ladder-step">第 ${step} 步</div>` +
      `<div class="ladder-value">${amount ?? "-"} U</div>` +
      `<div class="ladder-detail">${currentStep === step ? "当前正在执行的金额" : currentStep !== null && step === currentStep + 1 ? "如果继续亏损，下一步会到这里" : step === 1 ? "新一轮开始时会从这里起步" : "按马丁翻倍推算"}</div>`;
    martingaleLadder.appendChild(div);
  }

  renderDetailList(strategyDetailList, [
    { label: "当前策略类型", value: preview.label || "未命名策略" },
    { label: "当前策略目录", value: preview.dir || active?.strategyDir || "-" },
    { label: "策略生成时间", value: preview.generatedAtUtc || "-" },
    {
      label: "数据窗口说明",
      value: `训练窗口约 ${preview.trainWindowDays ?? "-"} 天；样本外按 ${preview.stepDays ?? "-"} 天一步滚动；当前 walk-forward 共 ${preview.walkForward?.nSteps ?? 0} 步。`,
      extra: "如果这里显示 1 步，表示只形成了 1 段样本外测试，不代表只测试了 1 天。",
    },
    { label: "walk-forward 表现", value: preview.walkForward ? `总收益 ${preview.walkForward.totalPnlU.toFixed(2)}U / 爆仓 ${preview.walkForward.totalBlowups} 次 / 最大回撤 ${preview.walkForward.maxStepDrawdownU.toFixed(2)}U` : "当前缺少 walk-forward 摘要" },
    {
      label: "这些数字的意思",
      value: "样本外总收益、爆仓次数、最大回撤都只统计样本外测试阶段，用来比较候选策略强弱，不等于未来实盘收益承诺。",
      extra: "判断策略时请把收益、回撤、爆仓次数、walk-forward 步数一起看，不要只看单个数字。",
    },
    { label: "推荐说明", value: preview.recommendationReason || "暂无推荐说明" },
    { label: "切换说明", value: "先选策略，再点“设为当前策略并保存”，最后点启动运行", extra: "如果不保存，只是预览，不会正式生效" },
  ]);
}

function applyConfigToForm(config) {
  latestConfig = config;
  form.profileName.value = config.profileName || "";
  form.privateKey.value = config.credentials.privateKey || "";
  form.walletAddress.value = config.credentials.walletAddress || "";
  form.funderAddress.value = config.credentials.funderAddress || "";
  form.signatureType.value = String(config.credentials.signatureType ?? 3);
  form.executeLive.value = String(Boolean(config.trading.executeLive));
  form.commitState.value = String(Boolean(config.trading.commitState));
  form.intervalMs.value = String(config.trading.intervalMs ?? 60000);
  form.baseStakeU.value = String(config.trading.baseStakeU ?? 2);
  form.autoRedeemEnabled.value = String(Boolean(config.redemption.autoRedeemEnabled));
  form.relayerApiKey.value = config.redemption.relayerApiKey || "";
  form.relayerApiKeyAddress.value = config.redemption.relayerApiKeyAddress || "";
  form.maxDailyLossU.value = String(config.riskLimits.maxDailyLossU ?? 0);
  form.maxConsecutiveBlowups.value = String(config.riskLimits.maxConsecutiveBlowups ?? 0);
  form.maxApiFailures.value = String(config.riskLimits.maxApiFailures ?? 0);
  form.host.value = config.network.host || "";
  form.rpcUrl.value = config.network.rpcUrl || "";
  form.binanceSymbol.value = config.network.binanceSymbol || "";
  form.chainId.value = String(config.network.chainId ?? 137);
  form.dataApiBaseUrl.value = config.network.dataApiBaseUrl || "";
  form.gammaApiBaseUrl.value = config.network.gammaApiBaseUrl || "";
  form.binanceApiBaseUrl.value = config.network.binanceApiBaseUrl || "";
  form.scheduledTaskName.value = config.windows.scheduledTaskName || "";
  syncStrategySelection();
  renderStrategyPanel();
}

function buildConfigFromForm() {
  if (!latestConfig) {
    throw new Error("配置尚未加载完成，请先点击重新载入配置。");
  }

  const selectedStrategyDir = form.strategySelect.value.trim();
  if (!selectedStrategyDir) {
    throw new Error("请先选择一个可用策略。");
  }

  return {
    ...latestConfig,
    profileName: form.profileName.value.trim(),
    credentials: {
      ...latestConfig.credentials,
      privateKey: form.privateKey.value.trim(),
      walletAddress: form.walletAddress.value.trim(),
      funderAddress: form.funderAddress.value.trim(),
      signatureType: numberFromInput(form.signatureType.value, 3),
    },
    network: {
      ...latestConfig.network,
      host: form.host.value.trim(),
      rpcUrl: form.rpcUrl.value.trim(),
      binanceSymbol: form.binanceSymbol.value.trim(),
      chainId: numberFromInput(form.chainId.value, 137),
      dataApiBaseUrl: form.dataApiBaseUrl.value.trim(),
      gammaApiBaseUrl: form.gammaApiBaseUrl.value.trim(),
      binanceApiBaseUrl: form.binanceApiBaseUrl.value.trim(),
    },
    trading: {
      ...latestConfig.trading,
      executeLive: boolFromSelect(form.executeLive.value),
      commitState: boolFromSelect(form.commitState.value),
      intervalMs: numberFromInput(form.intervalMs.value, 60000),
      strategyDir: selectedStrategyDir,
      baseStakeU: numberFromInput(form.baseStakeU.value, 2),
    },
    redemption: {
      ...latestConfig.redemption,
      autoRedeemEnabled: boolFromSelect(form.autoRedeemEnabled.value),
      relayerApiKey: form.relayerApiKey.value.trim(),
      relayerApiKeyAddress: form.relayerApiKeyAddress.value.trim(),
    },
    riskLimits: {
      ...latestConfig.riskLimits,
      maxDailyLossU: numberFromInput(form.maxDailyLossU.value, 0),
      maxConsecutiveBlowups: numberFromInput(form.maxConsecutiveBlowups.value, 0),
      maxApiFailures: numberFromInput(form.maxApiFailures.value, 0),
    },
    windows: {
      ...latestConfig.windows,
      scheduledTaskName: form.scheduledTaskName.value.trim(),
    },
  };
}

function applyControls(controls) {
  controlButtons.start.disabled = !controls.canStart;
  controlButtons.stop.disabled = !controls.canStop;
  controlButtons.restart.disabled = !(controls.canStart || controls.canStop);
  controlButtons.pause.disabled = !controls.canPause;
  controlButtons.resume.disabled = !controls.canResume;
}

function renderState(state) {
  latestState = state;
  generatedAt.textContent = `生成时间: ${state.generatedAt}`;
  statusLine.textContent = `${state.overview.profileName} | ${friendlyHealth(state.overview.health)} | ${friendlyRunnerStatus(state.overview.runnerStatus)}`;
  configPath.textContent = state.configFile;
  const activeStrategy = state.pages.strategy.active;
  renderHeroCards([
    {
      title: "程序当前状态",
      value: friendlyHealth(state.overview.health),
      detail: `${friendlyMode(state.overview.executeLive)} | ${state.overview.runtimePaused ? "已暂停" : "可正常运行"}`,
    },
    {
      title: "当前策略",
      value: activeStrategy?.version || "未识别",
      detail: activeStrategy ? `${activeStrategy.pattern} | 允许状态 ${activeStrategy.allowedStatesCount} 个` : "请先检查策略目录和配置",
    },
    {
      title: "当前应下注金额",
      value: activeStrategy?.currentStakeU
        ? `${activeStrategy.currentStakeU} U`
        : `${(activeStrategy?.nextStakeU ?? form.baseStakeU.value ?? 2)} U`,
      detail: activeStrategy?.currentStep ? `当前为第 ${activeStrategy.currentStep} 步` : "当前未开新轮，下一轮将从首步金额开始",
    },
    {
      title: "最近动作",
      value: friendlyAction(state.overview.lastAction),
      detail: state.overview.activeOrderId ? `当前订单：${state.overview.activeOrderId}` : "当前没有活动中的订单",
    },
  ]);
  renderBanners(state.pages.dashboard.banners);
  renderStatusCards(
    [
      { label: "程序状态", value: friendlyHealth(state.overview.health), tone: state.overview.health === "running" || state.overview.health === "sleeping" ? "good" : state.overview.health === "error" || state.overview.health === "stale" ? "danger" : state.overview.health === "runtime_paused" ? "warning" : "neutral" },
      { label: "运行模式", value: state.overview.executeLive ? "真实运行" : "模拟运行", tone: state.overview.executeLive ? "warning" : "neutral" },
      { label: "轮询间隔", value: `${state.overview.intervalMs} 毫秒`, tone: "neutral" },
      { label: "暂停状态", value: state.overview.runtimePaused ? "已暂停" : "正常", tone: state.overview.runtimePaused ? "warning" : "good" },
      { label: "最近动作", value: friendlyAction(state.overview.lastAction), tone: "neutral" },
      { label: "当前订单", value: state.overview.activeOrderId || "暂无", tone: state.overview.activeOrderId ? "warning" : "neutral" },
    ],
    cardGrid,
  );
  renderIssues(state.configIssues);
  renderRuntime(state.pages.runtime);
  renderLogs(state.pages.logs);
  renderStrategyCenterSummary(state.pages.strategy);
  renderStrategyOptions(state.pages.strategy.available || []);
  renderCandidateStrategies(state.pages.strategy);
  renderStrategyPanel();
  applyControls(state.controls);
}

async function refreshState() {
  const state = await fetchJson("/api/state");
  renderState(state);
}

async function loadConfig() {
  const payload = await fetchJson("/api/config/raw");
  applyConfigToForm(payload.config);
}

async function loadPaths() {
  const payload = await fetchJson("/api/system/paths");
  renderPaths(payload.entries || []);
}

async function saveConfig() {
  const parsed = buildConfigFromForm();
  const payload = await fetchJson("/api/config/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: parsed }),
  });
  latestConfig = parsed;
  actionOutput.textContent = `保存成功\n配置文件：${payload.filePath}\n当前策略：${parsed.trading.strategyDir}\n初始马丁金额：${parsed.trading.baseStakeU} U`;
  renderState(payload.state);
}

async function postAction(url, body = {}) {
  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  actionOutput.textContent = `操作成功\n${formatJson(payload.result || payload)}`;
  renderState(payload.state);
}

async function openPath(target) {
  const payload = await fetchJson("/api/system/open-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  actionOutput.textContent = `已请求打开文件夹\n${payload.path}\n如果当前是网页预览环境，系统文件夹可能不会直接弹出；放到目录版 EXE 中可直接打开。`;
}

refreshButton.addEventListener("click", async () => {
  await refreshState();
});

loadConfigButton.addEventListener("click", async () => {
  await loadConfig();
});

saveConfigButton.addEventListener("click", async () => {
  try {
    await saveConfig();
    await loadPaths();
  } catch (error) {
    actionOutput.textContent = `保存失败\n${error instanceof Error ? error.message : String(error)}`;
  }
});

openConfigDirButton.addEventListener("click", async () => {
  await openPath("config_dir");
});
openLogsDirButton.addEventListener("click", async () => {
  await openPath("logs_dir");
});
openStrategyDirButton.addEventListener("click", async () => {
  await openPath("strategy_dir");
});

strategyReloadButton.addEventListener("click", async () => {
  try {
    strategyReloadButton.disabled = true;
    startStrategyProgress();
    actionOutput.textContent = "正在执行全量重算并选优，请稍等...";
    const payload = await fetchJson("/api/strategy/rescan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", mode: "full_scan" }),
    });
    await pollStrategyRescanJob(payload.jobId);
  } catch (error) {
    failStrategyProgress(error instanceof Error ? error.message : String(error));
    actionOutput.textContent = `全量重算并选优失败\n${error instanceof Error ? error.message : String(error)}`;
  } finally {
    strategyReloadButton.disabled = false;
  }
});

autoPickStrategyButton.addEventListener("click", () => {
  const recommended = pickRecommendedStrategy();
  if (!recommended) {
    actionOutput.textContent = "当前没有可自动选择的推荐策略。";
    return;
  }
  form.strategySelect.value = recommended.dir;
  renderStrategyPanel();
  actionOutput.textContent = `已选中系统推荐策略\n${recommended.label}\n请再点击“设为当前策略并保存”让它正式生效。`;
});

applyStrategyButton.addEventListener("click", async () => {
  try {
    await saveConfig();
    await loadPaths();
  } catch (error) {
    actionOutput.textContent = `设置当前策略失败\n${error instanceof Error ? error.message : String(error)}`;
  }
});

candidateStrategyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='select-candidate']");
  if (!button) {
    return;
  }
  const dir = button.getAttribute("data-dir") || "";
  if (!dir) {
    return;
  }
  form.strategySelect.value = dir;
  renderStrategyPanel();
  const selected = getSelectedStrategyMeta();
  actionOutput.textContent = `已选中候选策略\n${selected?.label || dir}\n请点击“设为当前策略并保存”让它正式生效。`;
});

form.strategySelect.addEventListener("change", () => {
  renderStrategyPanel();
});

form.baseStakeU.addEventListener("input", () => {
  renderStrategyPanel();
});

controlButtons.start.addEventListener("click", async () => {
  await postAction("/api/daemon/start");
});
controlButtons.stop.addEventListener("click", async () => {
  await postAction("/api/daemon/stop");
});
controlButtons.restart.addEventListener("click", async () => {
  await postAction("/api/daemon/restart");
});
controlButtons.pause.addEventListener("click", async () => {
  await postAction("/api/runtime/pause", {
    code: "MANUAL_PAUSE",
    reason: "用户在界面中手动暂停交易；daemon 保持运行，但不再继续开仓。",
  });
  actionOutput.textContent =
    "已执行暂停交易\n" +
    "daemon 仍会保留运行状态，但后续不会继续开仓。\n" +
    "如果要彻底停机，请使用“停止运行”。";
});
controlButtons.resume.addEventListener("click", async () => {
  await postAction("/api/runtime/resume", {
    reason: "用户在界面中手动恢复交易。",
  });
  actionOutput.textContent =
    "已执行恢复交易\n" +
    "daemon 将继续按当前配置检查信号并在满足条件时自动开仓。";
});

async function bootstrap() {
  try {
    await Promise.all([refreshState(), loadConfig(), loadPaths()]);
  } catch (error) {
    actionOutput.textContent = `初始化失败\n${error instanceof Error ? error.message : String(error)}`;
  }
}

bootstrap();
window.setInterval(() => {
  refreshState().catch((error) => {
    actionOutput.textContent = `自动刷新失败\n${error instanceof Error ? error.message : String(error)}`;
  });
}, 5000);
