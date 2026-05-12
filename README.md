# Polymarket 马丁系统

本仓库用于开发与运行 **Polymarket 马丁交易系统**（当前阶段以研究与工程落地为主）。

核心开发文档：
- `polymarket_martingale_system_dev_doc.md`

## 快速开始（研究 / 回测工具）

> 默认使用 Python 3.12。

### 1) 下载 BTCUSDT 1H K 线（365 天）

```bash
PYTHONPATH=kronos_v1_backtest/src \
  python3 -m kronos_v1_backtest.cli \
  --download-binance --symbol BTCUSDT --days 365 \
  --csv kronos_v1_backtest/data/raw/binance/BTCUSDT_1h_365d.csv
```

### 2) 穷举 64 个 pattern 的 6 步马丁回测

```bash
PYTHONPATH=kronos_v1_backtest/src \
  python3 -m kronos_v1_backtest.cli \
  --csv kronos_v1_backtest/data/raw/binance/BTCUSDT_1h_365d.csv \
  --martingale-enum --topn 10
```

### 3) 生成条件风险表（倒着推，N=72）

```bash
PYTHONPATH=kronos_v1_backtest/src \
  python3 -m kronos_v1_backtest.cli \
  --csv kronos_v1_backtest/data/raw/binance/BTCUSDT_1h_365d.csv \
  --conditional-risk --risk-horizon 72 --train-ratio 0.75 \
  --risk-pattern UUUUUU
```

## 实盘说明（当前决策）

- 入金：手动入金；软件仅负责交易。
- 私钥：不落盘保存（每次运行手动输入，模式 1）。
- 更新：每周滚动更新一次（训练窗口 365 天）。

