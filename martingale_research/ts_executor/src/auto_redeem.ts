import type {
  DepositWalletCall,
} from "@polymarket/builder-relayer-client/dist/types";
import { encodeFunctionData, prepareEncodeFunctionData, zeroHash } from "viem";

import { createRelayClient, hasRelayerCredentials } from "./auth.js";
import { locateCurrentBtc1hMarket } from "./market_locator.js";
import { getPositionsSnapshot } from "./positions.js";
import type { ExecutorConfig, RuntimeStateV2, SessionContext } from "./types.js";

const CTF_CONTRACT_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
const POLYGON_USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ONE_HOUR_MS = 60 * 60 * 1000;
const DEPOSIT_WALLET_BATCH_DEADLINE_SECONDS = 4 * 60;

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
    args: [POLYGON_USDC_ADDRESS, zeroHash, conditionId as `0x${string}`, [1n, 2n]],
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

  const market = await locateCurrentBtc1hMarket(config, {
    targetTime: new Date(marketStartTime),
    includeClosed: true,
    maxPages: 6,
  });
  if (!market) {
    return {
      status: "submission_skipped",
      reason: "未能定位上一笔对应的 BTC 1H 市场。",
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

  const position = await getPositionsSnapshot(config, session, tokenId);
  if (!(position.size > 0)) {
    return {
      status: "pending_position",
      reason: "账户中已没有待回款仓位，可能已手动处理或已回款完成。",
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
  if (!hasRelayerCredentials(config)) {
    return {
      status: "submission_skipped",
      reason: "自动回款缺少 Relayer API keys，请先在 GUI 中补全后再启用。",
      tokenId,
      conditionId: market.conditionId,
      marketStartTime,
    };
  }
  if (
    state.redemption.status === "submitted" &&
    state.redemption.lastSubmittedConditionId === market.conditionId
  ) {
    return {
      status: "submitted",
      reason: "上一笔市场的自动回款已经提交过，本轮不重复发起。",
      tokenId,
      conditionId: market.conditionId,
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
      conditionId: market.conditionId,
      marketStartTime,
    };
  }

  const response = await relayClient.executeDepositWalletBatch(
    [buildCtfRedeemCall(market.conditionId)],
    depositWalletAddress,
    createDepositWalletDeadline(),
  );

  return {
    status: "submitted",
    reason: "已提交自动回款请求，后台等待 relayer 出链确认。",
    tokenId,
    conditionId: market.conditionId,
    marketStartTime,
    transactionId: String(response.transactionID ?? ""),
    transactionHash: String(response.transactionHash ?? response.hash ?? ""),
  };
}
