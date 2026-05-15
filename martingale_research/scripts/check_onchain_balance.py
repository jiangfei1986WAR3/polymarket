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

from web3 import Web3

OKX_WALLET_ADDRESS = "0xD5e4CcE75FD49274d0E28C4fF522f380905532E1"
USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

RPC_ENDPOINTS = [
    "https://rpc.ankr.com/polygon",
    "https://polygon-rpc.com",
    "https://1rpc.io/matic",
    "https://matic-mainnet.chainstacklabs.com",
]

def main():
    print("=== 重新检查 OKX 钱包链上 USDC 余额 ===")
    print(f"钱包地址: {OKX_WALLET_ADDRESS}")
    print()

    usdc_abi = [{'name': 'balanceOf', 'type': 'function', 'inputs': [{'name': 'account', 'type': 'address'}], 'outputs': [{'name': '', 'type': 'uint256'}], 'stateMutability': 'view'}]

    for rpc in RPC_ENDPOINTS:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc))
            if w3.is_connected():
                balance = w3.eth.contract(Web3.to_checksum_address(USDC_CONTRACT), abi=usdc_abi).functions.balanceOf(Web3.to_checksum_address(OKX_WALLET_ADDRESS)).call()
                print(f"[{rpc}]")
                print(f"  USDC 余额: {balance / 1e6} USDC")
                print(f"  链上区块号: {w3.eth.block_number}")
                break
        except Exception as exc:
            print(f"[{rpc}] 失败: {exc}")

if __name__ == "__main__":
    main()