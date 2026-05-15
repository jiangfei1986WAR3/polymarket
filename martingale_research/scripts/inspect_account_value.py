from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import requests  # noqa: E402


DATA_API = "https://data-api.polymarket.com"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="inspect-account-value")
    p.add_argument("--user", required=True, help="User/profile/deposit wallet address to inspect")
    p.add_argument("--positions-limit", type=int, default=20, help="How many current positions to fetch")
    return p.parse_args()


def _get_json(path: str, params: dict[str, object]) -> object:
    response = requests.get(f"{DATA_API}{path}", params=params, timeout=20)
    response.raise_for_status()
    return response.json()


def main() -> None:
    args = _parse_args()
    value = _get_json("/value", {"user": args.user})
    positions = _get_json(
        "/positions",
        {
            "user": args.user,
            "limit": args.positions_limit,
            "sortBy": "CURRENT",
            "sortDirection": "DESC",
        },
    )
    activity = _get_json(
        "/activity",
        {
            "user": args.user,
            "limit": 20,
            "sortBy": "TIMESTAMP",
            "sortDirection": "DESC",
        },
    )
    out = {
        "user": args.user,
        "value": value,
        "positions": positions,
        "activity": activity,
    }
    print(json.dumps(out, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
