import { ClobClient } from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { ExecutorConfig, SessionContext } from "./types.js";

export function createTradingClient(config: ExecutorConfig, session: SessionContext): ClobClient {
  if (!config.privateKey) {
    throw new Error("Missing private key in executor config");
  }

  const signer = createWalletClient({
    account: privateKeyToAccount(config.privateKey),
    transport: http(session.rpcUrl),
  });

  return new ClobClient({
    host: session.host,
    chain: session.chainId,
    signer,
    creds: {
      key: session.creds.key,
      secret: session.creds.secret,
      passphrase: session.creds.passphrase,
    },
    signatureType: session.signatureType,
    funderAddress: session.funderAddress,
  });
}
