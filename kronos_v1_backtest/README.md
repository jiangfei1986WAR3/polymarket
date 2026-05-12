# Kronos V1 Backtest (BTC-only)

This folder implements the V1 Binance-only backtest and supports local Kronos-base inference.

## What is implemented

- CSV loader + quality check
- Strict sample builder (no future leak)
- Path error (return MSE on known 11 candles)
- Aggregations: all / topk / randomk
- Metrics: Brier + Accuracy
- Kronos modes: mock / http / local (Kronos-base)
- Prediction cache (JSON)

## Local Kronos-base setup

Downloaded into:
- kronos_external/Kronos
- kronos_external/hf_cache/Kronos-base
- kronos_external/hf_cache/Kronos-Tokenizer-base

Python venv:
- kronos_v1_backtest/.venv

## Run (local Kronos-base)

For quick, non-ML tooling without installing the package, run via `PYTHONPATH`:

- Martingale pattern enumeration (2^6 patterns):
  - `PYTHONPATH=kronos_v1_backtest/src python3 -m kronos_v1_backtest.cli --csv <path.csv> --martingale-enum`

Notes:
- `--martingale-enum` does not require pandas/torch; other modes may.



Notes:
- KronosPredictor averages sample_count internally; V1 requests N paths by calling it N times with sample_count=1.
- Use --cache-dir to cache paths and avoid recomputing expensive inference.


GPU note: GPU is accessible only in non-sandbox (escalated) runs in this environment.
