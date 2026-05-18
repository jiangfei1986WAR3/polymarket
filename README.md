# Polymarket 马丁系统

本仓库用于开发与运行 **Polymarket 马丁交易系统**，当前阶段聚焦于马丁策略研究、回测和风险过滤。

核心开发文档：
- `polymarket_martingale_system_dev_doc.md`
- `polymarket_martingale_handoff_2026-05-15.md`
- `polymarket_server_recovery_guide.md`
- `polymarket_email_account_mode_design_2026-05-17.md`
- `polymarket_email_deposit_wallet_success_2026-05-18.md`

## 快速开始（研究 / 回测工具）

> 默认使用 Python 3.12。

### 1) 下载 BTCUSDT 1H K 线（365 天）

```bash
PYTHONPATH=martingale_research/src \
  python3 -m martingale_research.cli \
  --download-binance --symbol BTCUSDT --days 365 \
  --csv martingale_research/data/raw/binance/BTCUSDT_1h_365d.csv
```

### 2) 穷举 64 个 pattern 的 6 步马丁回测

```bash
PYTHONPATH=martingale_research/src \
  python3 -m martingale_research.cli \
  --csv martingale_research/data/raw/binance/BTCUSDT_1h_365d.csv \
  --martingale-enum --topn 10
```

### 3) 生成条件风险表（倒着推，N=72）

```bash
PYTHONPATH=martingale_research/src \
  python3 -m martingale_research.cli \
  --csv martingale_research/data/raw/binance/BTCUSDT_1h_365d.csv \
  --conditional-risk --risk-horizon 72 --train-ratio 0.75 \
  --risk-pattern UUUUUU
```

## 当前范围

- Binance K 线下载
- CSV 读取
- 数据质量检查
- 马丁穷举
- 条件风险表
- 状态驱动实验

## 实盘说明（当前决策）

- 入金：手动入金；软件仅负责交易。
- 私钥：不落盘保存（每次运行手动输入，模式 1）。
- 更新：每周滚动更新一次（训练窗口 365 天）。




                你的软件配置
    ┌─────────────────────────────────┐
    │ privateKey                      │
    │ walletAddress = 0xD5e4...32E1   │
    │ funderAddress = 0x7Bd9...8a6f   │
    │ signatureType = 3               │
    └─────────────────────────────────┘
                    │
                    │ privateKey 控制 / 签名
                    ▼
    ┌─────────────────────────────────┐
    │ walletAddress                   │
    │ 0xD5e4...32E1                   │
    │ 这是你当前连接到 Polymarket 的  │
    │ 钱包签名地址                    │
    └─────────────────────────────────┘
                    │
                    │ 登录 / 签名 / 下单身份
                    ▼
    ┌─────────────────────────────────┐
    │ Polymarket 账户                 │
    │ 网页里默认显示的 Recipient      │
    │ address 往往就是这个地址        │
    └─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        │ 提现到当前连接钱包     │ 提现到别的地方
        ▼                       ▼

┌──────────────────────┐   ┌──────────────────────────┐
│ 当前钱包地址         │   │ 目标地址由你手动填写      │
│ 0xD5e4...32E1        │   │ 可以是别的钱包地址        │
│ 如果这就是你的       │   │ 或 OKX 交易所充值地址     │
│ OKX Wallet 地址      │   │                          │
│ 那就等于提回 OKX钱包 │   │                          │
└──────────────────────┘   └──────────────────────────┘
