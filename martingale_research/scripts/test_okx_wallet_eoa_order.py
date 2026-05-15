from __future__ import annotations
import json
import sys
from pathlib import Path

def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]

ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from py_clob_client_v2.clob_types import MarketOrderArgs, OrderType, BalanceAllowanceParams, AssetType, ApiCreds
from py_clob_client_v2.order_builder.constants import BUY, SELL
from martingale_research.execution import PolymarketSessionBridge

OKX_PRIVATE_KEY = "0x11555ce1d2e739fca0d0ef9158ef45c7181e2bc85295f75eb2607c54218838d4"
OKX_WALLET_ADDRESS = "0xD5e4CcE75FD49274d0E28C4fF522f380905532E1"

TRADING_CONFIG = ROOT / "config" / "polymarket_trading_session.example.json"

BTC_CONDITION_ID = "54246525395741880665740271516930934380290525911040487877801838221765386862700"

def main():
    print("=== OKX 钱包 EOA 完整流程测试 ===")
    print(f"钱包地址: {OKX_WALLET_ADDRESS}")
    print()

    bridge = PolymarketSessionBridge.from_json(str(TRADING_CONFIG))
    client_cls, module_name = bridge._load_clob_client_class()

    runtime_cfg = bridge.build_runtime_config(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
    )
    print(f"signature_type: {runtime_cfg.signature_type} (0=EOA)")
    print()

    sdk_client = bridge._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg)

    print("1. 创建 L2 API Key")
    creds = sdk_client.create_or_derive_api_key()
    print(f"   api_key: {creds.api_key}")
    print()

    l2_creds = ApiCreds(
        api_key=creds.api_key,
        api_secret=creds.api_secret,
        api_passphrase=creds.api_passphrase,
    )
    runtime_cfg_l2 = bridge.build_runtime_config(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
        creds=l2_creds,
    )
    sdk_client_l2 = bridge._create_sdk_client(client_cls=client_cls, runtime_cfg=runtime_cfg_l2)
    print("   L2 client 创建成功")
    print()

    print("2. 查询余额授权状态")
    try:
        params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=0)
        raw = sdk_client_l2.get_balance_allowance(params)
        print(f"   原始响应: {json.dumps(raw, ensure_ascii=True, indent=4)}")
        allowances = raw.get("allowances", {})
        print(f"   CLOB余额: {raw.get('balance', 'N/A')} USDC")
        print(f"   授权地址数量: {len(allowances)}")
        for addr, amt in allowances.items():
            print(f"   - {addr}: {amt}")
    except Exception as exc:
        print(f"   失败: {exc}")
    print()

    print("3. 调用 update_balance_allowance (触发链上授权)")
    try:
        params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=0)
        updated = sdk_client_l2.update_balance_allowance(params)
        print(f"   update_balance_allowance 返回: {json.dumps(updated, ensure_ascii=True, indent=4)}")
    except Exception as exc:
        print(f"   update_balance_allowance 失败: {exc}")
    print()

    print("4. 再次查询余额授权状态")
    try:
        params = BalanceAllowanceParams(asset_type=AssetType.COLLATERAL, signature_type=0)
        raw = sdk_client_l2.get_balance_allowance(params)
        print(f"   CLOB余额: {raw.get('balance', 'N/A')} USDC")
        allowances = raw.get("allowances", {})
        for addr, amt in allowances.items():
            if amt != "0":
                print(f"   - {addr}: {amt}")
    except Exception as exc:
        print(f"   失败: {exc}")
    print()

    print("5. 尝试下单")
    try:
        market_args = MarketOrderArgs(
            token_id=BTC_CONDITION_ID,
            amount=1.0,
            side=BUY,
            price=0.99,
            order_type=OrderType.FOK,
        )
        signed = sdk_client_l2.create_market_order(market_args)
        print(f"   订单签名成功")

        posted = sdk_client_l2.post_order(signed, OrderType.FOK)
        print(f"   post_order 成功: {json.dumps(posted, ensure_ascii=True, indent=4, default=str)}")
    except Exception as exc:
        print(f"   下单失败: {exc}")
        if hasattr(exc, 'status_code'):
            print(f"   HTTP状态码: {exc.status_code}")

if __name__ == "__main__":
    main()