import { ClobClient, OrderType, Side } from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const RPC_URL = process.env.POLYGON_RPC_URL ?? "https://1rpc.io/matic";
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY as `0x${string}` | undefined;
const TOKEN_ID = process.env.POLYMARKET_TOKEN_ID ?? "54246525395741880665740271516930934380290525911040487877801838221765386862700";
const FUNDER_ADDRESS = process.env.POLYMARKET_FUNDER_ADDRESS ?? "0x7Bd9870729b335269494F6E9F2bcE43E62C98a6f";
const SIGNATURE_TYPE = Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "3");
const ORDER_PRICE = Number(process.env.POLYMARKET_ORDER_PRICE ?? "0.99");
const ORDER_SIZE = Number(process.env.POLYMARKET_ORDER_SIZE ?? "2");
const ORDER_SIDE = (process.env.POLYMARKET_ORDER_SIDE ?? "BUY").toUpperCase();

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  if (!PRIVATE_KEY) {
    fail("Missing POLYMARKET_PRIVATE_KEY");
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const signer = createWalletClient({
    account,
    transport: http(RPC_URL),
  });

  console.log("signer", account.address);
  console.log("funder", FUNDER_ADDRESS);
  console.log("signatureType", SIGNATURE_TYPE);
  console.log("rpc", RPC_URL);
  console.log("tokenId", TOKEN_ID);
  console.log("orderPrice", ORDER_PRICE);
  console.log("orderSize", ORDER_SIZE);
  console.log("orderSide", ORDER_SIDE);

  const tempClient = new ClobClient({
    host: HOST,
    chain: CHAIN_ID,
    signer,
  });

  let apiCreds;
  try {
    apiCreds = await tempClient.createOrDeriveApiKey();
    console.log("apiCreds", JSON.stringify(apiCreds, null, 2));
  } catch (error) {
    console.log("createOrDeriveApiKey_error", error instanceof Error ? error.message : String(error));
    throw error;
  }

  const client = new ClobClient({
    host: HOST,
    chain: CHAIN_ID,
    signer,
    creds: apiCreds,
    signatureType: SIGNATURE_TYPE,
    funderAddress: FUNDER_ADDRESS,
  });

  try {
    const balanceAllowance = await client.getBalanceAllowance({
      asset_type: "COLLATERAL",
      signature_type: SIGNATURE_TYPE,
    } as never);
    console.log("balanceAllowance", JSON.stringify(balanceAllowance, null, 2));
  } catch (error) {
    console.log("getBalanceAllowance_error", error instanceof Error ? error.message : String(error));
  }

  try {
    const tickSize = await client.getTickSize(TOKEN_ID);
    console.log("tickSize", JSON.stringify(tickSize, null, 2));
  } catch (error) {
    console.log("getTickSize_error", error instanceof Error ? error.message : String(error));
  }

  try {
    const negRisk = await client.getNegRisk(TOKEN_ID);
    console.log("negRisk", JSON.stringify(negRisk, null, 2));
  } catch (error) {
    console.log("getNegRisk_error", error instanceof Error ? error.message : String(error));
  }

  try {
    const order = await client.createAndPostOrder(
      {
        tokenID: TOKEN_ID,
        price: ORDER_PRICE,
        size: ORDER_SIZE,
        side: ORDER_SIDE === "SELL" ? Side.SELL : Side.BUY,
      },
      {
        tickSize: "0.001",
        negRisk: false,
      },
      OrderType.GTC,
    );
    console.log("createAndPostOrder", JSON.stringify(order, null, 2));
  } catch (error) {
    console.log("createAndPostOrder_error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

main().catch((error) => {
  console.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});