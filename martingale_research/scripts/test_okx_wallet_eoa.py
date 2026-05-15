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

from martingale_research.execution import PolymarketSessionBridge

OKX_PRIVATE_KEY = "0x11555ce1d2e739fca0d0ef9158ef45c7181e2bc85295f75eb2607c54218838d4"
OKX_WALLET_ADDRESS = "0xD5e4CcE75FD49274d0E28C4fF522f380905532E1"

TRADING_CONFIG = ROOT / "config" / "polymarket_trading_session.example.json"

def main():
    print("=== OKX 钱包 EOA 模式 SDK 测试 ===")
    print(f"钱包地址: {OKX_WALLET_ADDRESS}")
    print()

    bridge = PolymarketSessionBridge.from_json(str(TRADING_CONFIG))

    print("1. 建立交易客户端 (signature_type=0 EOA)")
    runtime_client = bridge.build_trading_client(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
    )
    runtime_status = runtime_client.session_status()
    print(f"   session_status: {json.dumps(runtime_status.__dict__, ensure_ascii=True, indent=4)}")
    print()

    print("2. 推导 API Creds")
    creds = bridge.try_derive_api_creds(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
    )
    print(f"   key present: {bool(creds.key)}")
    print(f"   secret present: {bool(creds.secret)}")
    print(f"   passphrase present: {bool(creds.passphrase)}")
    print()

    print("3. 查询 balance_allowance (CLOB余额)")
    allowance = bridge.try_get_balance_allowance(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
        creds=creds,
        asset_type="COLLATERAL",
        token_id=None,
    )
    print(f"   {json.dumps(allowance.__dict__, ensure_ascii=True, indent=4)}")
    print()

    print("4. 调用 update_balance_allowance (授权USDC到CLOB)")
    try:
        updated = bridge.try_update_balance_allowance(
            private_key=OKX_PRIVATE_KEY,
            wallet_address=OKX_WALLET_ADDRESS,
            funder_address=OKX_WALLET_ADDRESS,
            creds=creds,
            asset_type="COLLATERAL",
            token_id=None,
        )
        print(f"   更新结果: {json.dumps(updated, ensure_ascii=True, indent=4)}")
    except Exception as exc:
        print(f"   更新失败: {exc}")
    print()

    print("5. 再次查询 balance_allowance")
    allowance_after = bridge.try_get_balance_allowance(
        private_key=OKX_PRIVATE_KEY,
        wallet_address=OKX_WALLET_ADDRESS,
        funder_address=OKX_WALLET_ADDRESS,
        creds=creds,
        asset_type="COLLATERAL",
        token_id=None,
    )
    print(f"   {json.dumps(allowance_after.__dict__, ensure_ascii=True, indent=4)}")

if __name__ == "__main__":
    main()