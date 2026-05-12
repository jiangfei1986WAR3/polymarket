from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..data.candles import Candle
from ..matching.selector import PredPath


def _sample_key(model_input: list[Candle], horizon: int, n_paths: int, extra: dict) -> str:
    payload = {
        'horizon': horizon,
        'n_paths': n_paths,
        'extra': extra,
        'candles': [[c.open_time_ms, c.open, c.high, c.low, c.close, c.volume] for c in model_input],
    }
    b = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(b).hexdigest()


def load_paths_from_cache(cache_dir: str | Path, key: str):
    p = Path(cache_dir) / (key + '.json')
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding='utf-8'))
    out = []
    for path in data['paths']:
        cs = [
            Candle(
                open_time_ms=int(c[0]),
                open=float(c[1]),
                high=float(c[2]),
                low=float(c[3]),
                close=float(c[4]),
                volume=float(c[5]),
            )
            for c in path
        ]
        out.append(PredPath(candles=cs))
    return out


def save_paths_to_cache(cache_dir: str | Path, key: str, paths: list[PredPath]) -> None:
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    p = Path(cache_dir) / (key + '.json')
    data = {
        'paths': [
            [[c.open_time_ms, c.open, c.high, c.low, c.close, c.volume] for c in path.candles]
            for path in paths
        ]
    }
    p.write_text(json.dumps(data), encoding='utf-8')


def cached_predict_paths(
    *,
    cache_dir: str | Path,
    model_input: list[Candle],
    horizon: int,
    n_paths: int,
    extra: dict,
    predict_fn,
):
    key = _sample_key(model_input, horizon, n_paths, extra)
    cached = load_paths_from_cache(cache_dir, key)
    if cached is not None:
        return cached
    paths = predict_fn()
    save_paths_to_cache(cache_dir, key, paths)
    return paths
