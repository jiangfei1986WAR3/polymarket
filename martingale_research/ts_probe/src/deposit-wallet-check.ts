import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveDepositWallet } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RELAYER_URL = "https://relayer-v2.polymarket.com/";
const CHAIN_ID = 137;
const RPC_URL = process.env.POLYGON_RPC_URL ?? "https://1rpc.io/matic";
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY as `0x${string}` | undefined;

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  if (!PRIVATE_KEY) {
    fail("Missing POLYMARKET_PRIVATE_KEY");
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({
    account,
    transport: http(RPC_URL),
  });

  const config = getContractConfig(CHAIN_ID);
  const factory = config.DepositWalletContracts.DepositWalletFactory;
  const implementation = config.DepositWalletContracts.DepositWalletImplementation;
  const derived = deriveDepositWallet(account.address, factory, implementation);

  console.log("signer", account.address);
  console.log("factory", factory);
  console.log("implementation", implementation);
  console.log("derivedDepositWallet", derived);

  const relayClient = new RelayClient(RELAYER_URL, CHAIN_ID, wallet);

  try {
    const deployed = await relayClient.getDeployed(derived, "WALLET");
    console.log("deployed", deployed);
  } catch (error) {
    console.log("getDeployed_error", error instanceof Error ? error.message : String(error));
  }

  try {
    const alsoDerived = await relayClient.deriveDepositWalletAddress();
    console.log("relayClientDerivedDepositWallet", alsoDerived);
  } catch (error) {
    console.log("deriveDepositWalletAddress_error", error instanceof Error ? error.message : String(error));
  }
}

main().catch((error) => {
  console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});