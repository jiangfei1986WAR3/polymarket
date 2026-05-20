import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveDepositWallet } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { ClobClient } from "@polymarket/clob-client-v2";
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { ApiCreds, ExecutorConfig, ResolvedAccountContext, SessionContext } from "./types.js";

function normalizeApiCreds(raw: unknown): ApiCreds {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    key: String(data.key ?? data.apiKey ?? ""),
    secret: String(data.secret ?? ""),
    passphrase: String(data.passphrase ?? ""),
  };
}

function createSigner(config: ExecutorConfig): WalletClient {
  if (!config.privateKey) {
    throw new Error("Missing POLYMARKET_PRIVATE_KEY");
  }
  return createWalletClient({
    account: privateKeyToAccount(config.privateKey),
    transport: http(config.rpcUrl),
  });
}

type RelayHeaderAdapter = {
  isValid(): boolean;
  generateBuilderHeaders(method: string, path: string, body?: string): Promise<Record<string, string>>;
};

function createRelayerHeaderAdapter(config: ExecutorConfig): RelayHeaderAdapter | undefined {
  if (!config.relayerApiKey || !config.relayerApiKeyAddress) {
    return undefined;
  }
  return {
    isValid() {
      return true;
    },
    async generateBuilderHeaders(_method: string, _path: string, _body?: string) {
      return {
        RELAYER_API_KEY: String(config.relayerApiKey),
        RELAYER_API_KEY_ADDRESS: String(config.relayerApiKeyAddress),
      };
    },
  };
}

export function hasRelayerCredentials(config: ExecutorConfig): boolean {
  return Boolean(config.relayerApiKey && config.relayerApiKeyAddress);
}

export function createRelayClient(config: ExecutorConfig): RelayClient {
  return new RelayClient(
    "https://relayer-v2.polymarket.com/",
    config.chainId,
    createSigner(config),
    createRelayerHeaderAdapter(config) as never,
  );
}

function buildModeNote(config: ExecutorConfig): string {
  if (config.accountMode === "deposit_wallet_1271") {
    return "Polymarket 邮箱账户新模式，系统会优先使用 deposit wallet 作为真实交易钱包，并以 signatureType=3 走 POLY_1271 下单。";
  }
  return config.accountMode === "poly_proxy"
    ? "Polymarket 邮箱账户模式，使用导出私钥签名，并优先依赖配置中的 proxy funder 地址。"
    : "EOA 钱包模式，默认使用钱包地址作为 funder，保留当前已验证链路。";
}

function validateModeSpecificConfig(config: ExecutorConfig): void {
  if (config.accountMode === "eoa" && config.signatureType !== 0) {
    throw new Error("EOA 模式要求 signatureType=0，请检查 GUI 配置。");
  }
  if (config.accountMode === "poly_proxy") {
    if (config.signatureType !== 1) {
      throw new Error("POLY_PROXY 模式要求 signatureType=1，请检查 GUI 配置。");
    }
    if (!config.funderAddress) {
      throw new Error("POLY_PROXY 模式要求显式填写站内 proxy wallet 作为 funderAddress。");
    }
  }
  if (config.accountMode === "deposit_wallet_1271" && config.signatureType !== 3) {
    throw new Error("DEPOSIT_WALLET_1271 模式要求 signatureType=3，请检查 GUI 配置。");
  }
}

function validateSignerWalletRelation(config: ExecutorConfig): void {
  if (!config.privateKey || !config.walletAddress) {
    return;
  }
  const signerAddress = privateKeyToAccount(config.privateKey).address;
  if (signerAddress.toLowerCase() !== config.walletAddress.toLowerCase()) {
    throw new Error(
      `当前 privateKey 推导出的 signer 地址是 ${signerAddress}，但 GUI 配置里的 walletAddress 是 ${config.walletAddress}。请确认您填写的是导出私钥对应的 signer 地址。`,
    );
  }
}

function resolveFunderAddress(args: {
  config: ExecutorConfig;
  walletAddress: `0x${string}`;
  derivedFunder: `0x${string}`;
}): `0x${string}` {
  const { config, walletAddress, derivedFunder } = args;
  if (config.funderAddress) {
    return config.funderAddress;
  }
  if (config.accountMode === "deposit_wallet_1271") {
    return derivedFunder;
  }
  return walletAddress;
}

export async function resolveAccountContext(config: ExecutorConfig): Promise<ResolvedAccountContext> {
  if (!config.privateKey) {
    throw new Error("Missing POLYMARKET_PRIVATE_KEY");
  }
  validateModeSpecificConfig(config);
  validateSignerWalletRelation(config);

  const account = privateKeyToAccount(config.privateKey);
  const walletAddress = (config.walletAddress ?? account.address) as `0x${string}`;
  const signer = createSigner(config);

  const tempClient = new ClobClient({
    host: config.host,
    chain: config.chainId,
    signer,
  });
  const rawCreds = await tempClient.createOrDeriveApiKey();
  const creds = normalizeApiCreds(rawCreds);

  const contractConfig = getContractConfig(config.chainId);
  const derivedFunder = deriveDepositWallet(
    walletAddress,
    contractConfig.DepositWalletContracts.DepositWalletFactory,
    contractConfig.DepositWalletContracts.DepositWalletImplementation,
  ) as `0x${string}`;

  const funderAddress = resolveFunderAddress({
    config,
    walletAddress,
    derivedFunder,
  });
  const usedConfiguredFunder = Boolean(config.funderAddress);
  const derivedFunderMatchesConfigured = config.funderAddress
    ? config.funderAddress.toLowerCase() === derivedFunder.toLowerCase()
    : null;

  if (config.accountMode === "poly_proxy" && hasRelayerCredentials(config)) {
    // Probe relayer support for proxy-style funders without blocking EOA startup.
    const relayClient = new RelayClient(
      "https://relayer-v2.polymarket.com/",
      config.chainId,
      signer,
      createRelayerHeaderAdapter(config) as never,
    );
    await relayClient.getDeployed(funderAddress, "WALLET").catch(() => undefined);
  }

  return {
    accountMode: config.accountMode,
    walletAddress,
    funderAddress,
    signatureType: config.signatureType,
    derivedDepositWallet: derivedFunder,
    creds,
    privateKeyPresent: true,
    diagnostics: {
      usedConfiguredFunder,
      derivedFunderMatchesConfigured,
      modeNote: buildModeNote(config),
    },
  };
}

export async function resolveSessionContext(config: ExecutorConfig): Promise<SessionContext> {
  const resolved = await resolveAccountContext(config);
  return {
    accountMode: resolved.accountMode,
    host: config.host,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    walletAddress: resolved.walletAddress,
    funderAddress: resolved.funderAddress,
    signatureType: resolved.signatureType,
    creds: resolved.creds,
    privateKeyPresent: resolved.privateKeyPresent,
  };
}
