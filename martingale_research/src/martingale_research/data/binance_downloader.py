from __future__ import annotations

import csv
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests


@dataclass(frozen=True)
class BinanceDownloadResult:
    symbol: str
    interval: str
    start_utc: datetime
    end_utc: datetime
    n_candles: int
    out_csv: Path


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def download_binance_klines_1h(
    *,
    symbol: str,
    days: int,
    out_csv: str | Path,
    base_url: str = 'https://api.binance.com',
    sleep_s: float = 0.1,
) -> BinanceDownloadResult:
    if days <= 0:
        raise ValueError('days must be positive')

    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days)

    start_ms = _ms(start)
    end_ms = _ms(end)

    out: list[list] = []
    cur = start_ms

    while True:
        params = {
            'symbol': symbol,
            'interval': '1h',
            'limit': 1000,
            'startTime': cur,
            'endTime': end_ms,
        }
        r = requests.get(base_url.rstrip('/') + '/api/v3/klines', params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        if not data:
            break

        out.extend(data)
        last_open = int(data[-1][0])
        nxt = last_open + 3600_000
        if nxt <= cur:
            break
        cur = nxt
        if cur >= end_ms:
            break
        if len(data) < 1000:
            break
        time.sleep(sleep_s)

    out_path = Path(out_csv)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['open_time', 'open', 'high', 'low', 'close', 'volume'])
        for k in out:
            w.writerow([k[0], k[1], k[2], k[3], k[4], k[5]])

    return BinanceDownloadResult(
        symbol=symbol,
        interval='1h',
        start_utc=start,
        end_utc=end,
        n_candles=len(out),
        out_csv=out_path,
    )
