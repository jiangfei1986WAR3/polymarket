import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveDepositWallet } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { ClobClient } from "@polymarket/clob-client-v2";
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { ApiCreds, ExecutorConfig, SessionContext } from "./types.js";

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

export async function resolveSessionContext(config: ExecutorConfig): Promise<SessionContext> {
  if (!config.privateKey) {
    throw new Error("Missing POLYMARKET_PRIVATE_KEY");
  }

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

  const funderAddress = (config.funderAddress ?? derivedFunder) as `0x${string}`;

  // Warm the relayer path early so Phase A can fail fast on unsupported accounts.
  const relayClient = new RelayClient(
    "https://relayer-v2.polymarket.com/",
    config.chainId,
    signer,
    createRelayerHeaderAdapter(config) as never,
  );
  await relayClient.getDeployed(funderAddress, "WALLET").catch(() => undefined);

  return {
    host: config.host,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    walletAddress,
    funderAddress,
    signatureType: config.signatureType,
    creds,
    privateKeyPresent: true,
  };
}
