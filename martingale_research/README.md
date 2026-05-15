# Martingale Research Backtest

This folder implements Binance 1H data tooling and martingale research backtests.

## Implemented

- Binance 1H CSV downloader
- CSV loader
- 1H candle quality check
- 6-step martingale pattern enumeration
- Conditional risk table by last-6-candles state
- State-driven martingale experiment

## Run

For quick tooling without installing the package, run via `PYTHONPATH`:

```bash
PYTHONPATH=martingale_research/src python3 -m martingale_research.cli --csv <path.csv> --martingale-enum
```

On Windows PowerShell:

```powershell
$env:PYTHONPATH = "martingale_research/src"
python -m martingale_research.cli --csv <path.csv> --martingale-enum
```

## Notes

This project has been simplified to focus only on martingale research.
