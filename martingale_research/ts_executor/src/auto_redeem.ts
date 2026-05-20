import type {
  DepositWalletCall,
} from "@polymarket/builder-relayer-client/dist/types";
import { encodeFunctionData, prepareEncodeFunctionData, zeroHash } from "viem";

import { createRelayClient, hasRelayerCredentials } from "./auth.js";
import { createTradingClient } from "./client.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { getPositionsSnapshot } from "./positions.js";
import type { ExecutorConfig, MarketOutcomeToken, RuntimeStateV2, SessionContext } from "./types.js";

const CTF_CONTRACT_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
const POLYMARKET_PUSD_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const ONE_HOUR_MS = 60 * 60 * 1000;
// Leave enough buffer for relayer-side validation, queueing, and chain submission.
const DEPOSIT_WALLET_BATCH_DEADLINE_SECONDS = 15 * 60;

const ctfRedeemAbi = [
  {
    constant: false,
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    name: "redeemPositions",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const preparedRedeemCall = prepareEncodeFunctionData({
  abi: ctfRedeemAbi,
  functionName: "redeemPositions",
});

export interface AutoRedeemAttemptResult {
  status: RuntimeStateV2["redemption"]["status"];
  reason: string;
  tokenId: string;
  conditionId: string;
  marketStartTime: string;
  transactionId?: string;
  transactionHash?: string;
}

function buildCtfRedeemCall(conditionId: string): DepositWalletCall {
  const data = encodeFunctionData({
    ...preparedRedeemCall,
    args: [POLYMARKET_PUSD_ADDRESS, zeroHash, conditionId as `0x${string}`, [1n, 2n]],
  });
  return {
    target: CTF_CONTRACT_ADDRESS,
    data,
    value: "0",
  };
}

function createDepositWalletDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + DEPOSIT_WALLET_BATCH_DEADLINE_SECONDS);
}

function marketIncludesTokenId(tokenId: string, marketOutcomes: MarketOutcomeToken[]): boolean {
  const normalizedTokenId = tokenId.trim();
  if (!normalizedTokenId) {
    return false;
  }
  return marketOutcomes.some((outcome) => outcome.tokenId.trim() === normalizedTokenId);
}

function extractTokenIdsFromMarket(rawMarket: unknown): string[] {
  const market = (rawMarket ?? {}) as Record<string, unknown>;
  const tokenRows = Array.isArray(market.tokens) ? market.tokens : [];
  const tokenIdsFromRows = tokenRows
    .map((row) => {
      const token = row as Record<string, unknown>;
      return String(token.token_id ?? token.tokenId ?? token.asset ?? "");
    })
    .filter(Boolean);
  const clobTokenIds = Array.isArray(market.clobTokenIds) ? market.clobTokenIds.map((item) => String(item)) : [];
  return [...new Set([...tokenIdsFromRows, ...clobTokenIds])];
}

function marketIsClosedOrResolved(rawMarket: unknown): boolean {
  const market = (rawMarket ?? {}) as Record<string, unknown>;
  return Boolean(market.closed ?? false) || Boolean(market.resolved ?? false);
}

function marketIsNegRisk(rawMarket: unknown): boolean {
  const market = (rawMarket ?? {}) as Record<string, unknown>;
  return Boolean(market.negRisk ?? false);
}

function resolvePreviousMarketStartTime(state: RuntimeStateV2): string {
  if (state.run.lastProcessedCandleOpenTimeMs === null) {
    return "";
  }
  return new Date(state.run.lastProcessedCandleOpenTimeMs + ONE_HOUR_MS).toISOString();
}

export async function attemptAutoRedeemWinningPosition(args: {
  config: ExecutorConfig;
  session: SessionContext;
  state: RuntimeStateV2;
}): Promise<AutoRedeemAttemptResult> {
  const { config, session, state } = args;
  const tokenId = state.orders.lastOrderTokenId || state.positions.lastPositionTokenId;
  const persistedConditionId = state.orders.lastOrderConditionId.trim();
  const marketStartTime = resolvePreviousMarketStartTime(state);

  if (!config.autoRedeemEnabled) {
    return {
      status: "submission_skipped",
      reason: "自动回款已关闭。",
      tokenId,
      conditionId: "",
      marketStartTime,
    };
  }
  if (!tokenId) {
    return {
      status: "submission_skipped",
      reason: "缺少上一笔 winning tokenId，暂时无法发起自动回款。",
      tokenId: "",
      conditionId: "",
      marketStartTime,
    };
  }
  if (!marketStartTime) {
    return {
      status: "submission_skipped",
      reason: "缺少上一笔市场起始时间，暂时无法定位待回款市场。",
      tokenId,
      conditionId: "",
      marketStartTime: "",
    };
  }

  let redeemConditionId = persistedConditionId;
  if (!redeemConditionId) {
    const market = await locateCurrentBtc1hMarket(config, {
      targetTime: new Date(marketStartTime),
      includeClosed: true,
      maxPages: 6,
      requireExactStart: true,
    });
    if (!market) {
      return {
        status: "submission_skipped",
        reason: "未能精确定位上一笔对应起始时间的 BTC 1H 市场。",
        tokenId,
        conditionId: "",
        marketStartTime,
      };
    }
    if (!market.conditionId) {
      return {
        status: "submission_skipped",
        reason: "已定位到市场，但缺少 conditionId。",
        tokenId,
        conditionId: "",
        marketStartTime,
      };
    }
    if (!market.closed) {
      return {
        status: "pending_market_close",
        reason: "上一笔 winning market 还未进入 closed 状态，先记为待回款。",
        tokenId,
        conditionId: market.conditionId,
        marketStartTime,
      };
    }
    if (!marketIncludesTokenId(tokenId, market.outcomes)) {
      return {
        status: "submission_skipped",
        reason: "上一笔 winning tokenId 与定位到的市场 outcomes 不一致，已跳过自动回款以避免打到错误市场。",
        tokenId,
        conditionId: market.conditionId,
        marketStartTime,
      };
    }
    if (market.negRisk) {
      return {
        status: "submission_skipped",
        reason: "当前市场属于 neg-risk，现阶段仅接入了常规 CTF 自动回款。",
        tokenId,
        conditionId: market.conditionId,
        marketStartTime,
      };
    }
    redeemConditionId = market.conditionId;
  } else {
    try {
      const tradingClient = createTradingClient(config, session);
      const market = (await tradingClient.getMarket(redeemConditionId)) as Record<string, unknown> | null;
      if (!market) {
        return {
          status: "submission_skipped",
          reason: "已持久化上一笔 conditionId，但暂时无法查到对应市场详情，已跳过自动回款。",
          tokenId,
          conditionId: redeemConditionId,
          marketStartTime,
        };
      }
      if (!marketIsClosedOrResolved(market)) {
        return {
          status: "pending_market_close",
          reason: "上一笔 winning market 尚未进入官方可回款状态（resolved/closed），先记为待回款。",
          tokenId,
          conditionId: redeemConditionId,
          marketStartTime,
        };
      }
      if (marketIsNegRisk(market)) {
        return {
          status: "submission_skipped",
          reason: "当前市场属于 neg-risk，现阶段仅接入了常规 CTF 自动回款。",
          tokenId,
          conditionId: redeemConditionId,
          marketStartTime,
        };
      }
      if (!extractTokenIdsFromMarket(market).includes(tokenId.trim())) {
        return {
          status: "submission_skipped",
          reason: "已持久化的 conditionId 与上一笔 winning tokenId 不匹配，已跳过自动回款以避免错误回款。",
          tokenId,
          conditionId: redeemConditionId,
          marketStartTime,
        };
      }
    } catch (error) {
      return {
        status: "submission_skipped",
        reason: `已持久化上一笔 conditionId，但查询市场状态失败：${error instanceof Error ? error.message : String(error)}`,
        tokenId,
        conditionId: redeemConditionId,
        marketStartTime,
      };
    }
  }

  const position = await getPositionsSnapshot(config, session, tokenId);
  if (!(position.size > 0)) {
    return {
      status: "pending_position",
      reason: "账户中已没有待回款仓位，可能已手动处理或已回款完成。",
      tokenId,
      conditionId: redeemConditionId,
      marketStartTime,
    };
  }
  if (!hasRelayerCredentials(config)) {
    return {
      status: "submission_skipped",
      reason: "自动回款缺少 Relayer API keys，请先在 GUI 中补全后再启用。",
      tokenId,
      conditionId: redeemConditionId,
      marketStartTime,
    };
  }
  if (
    state.redemption.status === "submitted" &&
    state.redemption.lastSubmittedConditionId === redeemConditionId
  ) {
    return {
      status: "submitted",
      reason: "上一笔市场的自动回款已经提交过，本轮不重复发起。",
      tokenId,
      conditionId: redeemConditionId,
      marketStartTime,
      transactionId: state.redemption.lastTransactionId,
      transactionHash: state.redemption.lastTransactionHash,
    };
  }

  const relayClient = createRelayClient(config);
  const depositWalletAddress = session.funderAddress || session.walletAddress;
  const deployed = await relayClient.getDeployed(depositWalletAddress, "WALLET");
  if (!deployed) {
    return {
      status: "failed",
      reason: "当前 deposit wallet 尚未部署，暂时无法通过 deposit wallet batch 发起自动回款。",
      tokenId,
      conditionId: redeemConditionId,
      marketStartTime,
    };
  }

  const response = await relayClient.executeDepositWalletBatch(
    [buildCtfRedeemCall(redeemConditionId)],
    depositWalletAddress,
    createDepositWalletDeadline(),
  );

  return {
    status: "submitted",
    reason: "已提交自动回款请求，后台等待 relayer 出链确认。",
    tokenId,
    conditionId: redeemConditionId,
    marketStartTime,
    transactionId: String(response.transactionID ?? ""),
    transactionHash: String(response.transactionHash ?? response.hash ?? ""),
  };
}
