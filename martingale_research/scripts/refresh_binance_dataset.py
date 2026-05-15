from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


ROOT = _project_root()
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from martingale_research.data.binance_csv import load_binance_klines_csv  # noqa: E402
from martingale_research.data.binance_downloader import download_binance_klines_1h  # noqa: E402
from martingale_research.data.quality_check import quality_check_1h  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="refresh-binance-dataset")
    parser.add_argument(
        "--csv",
        default=str(ROOT / "data" / "raw" / "binance" / "BTCUSDT_1h_365d.csv"),
        help="Path to Binance 1H CSV",
    )
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--base-url", default="https://api.binance.com")
    return parser.parse_args()


def _emit_progress(**payload: object) -> None:
    print(json.dumps({"type": "progress", **payload}, ensure_ascii=False), flush=True)


def _emit_result(summary: dict[str, object]) -> None:
    print(json.dumps({"type": "result", "summary": summary}, ensure_ascii=False), flush=True)


def main() -> None:
    args = _parse_args()
    csv_path = Path(args.csv).resolve()

    _emit_progress(stage="刷新 Binance 数据", detail="正在下载最新 Binance 1H K 线。", progress_percent=10)
    download = download_binance_klines_1h(
        symbol=args.symbol,
        days=args.days,
        out_csv=csv_path,
        base_url=args.base_url,
    )

    _emit_progress(stage="加载 CSV", detail="正在读取刷新后的本地 CSV。", progress_percent=60)
    candles = load_binance_klines_csv(csv_path)

    _emit_progress(stage="质量校验", detail="正在检查缺失、重复和异常 OHLC。", progress_percent=85)
    report = quality_check_1h(candles)
    if report.duplicates or report.missing or report.invalid_ohlc:
        raise SystemExit(
            "quality_check failed: "
            f"duplicates={report.duplicates}, missing={report.missing}, invalid_ohlc={report.invalid_ohlc}"
        )

    summary = {
        "symbol": download.symbol,
        "interval": download.interval,
        "base_url": args.base_url,
        "days": args.days,
        "csv": str(csv_path),
        "n_candles": report.n,
        "duplicates": report.duplicates,
        "missing": report.missing,
        "invalid_ohlc": report.invalid_ohlc,
        "start_utc": download.start_utc.isoformat(),
        "end_utc": download.end_utc.isoformat(),
    }
    _emit_progress(
        stage="数据就绪",
        detail=f"已刷新 {report.n} 根 BTCUSDT 1H K 线，并通过质量校验。",
        progress_percent=100,
    )
    _emit_result(summary)


if __name__ == "__main__":
    main()
