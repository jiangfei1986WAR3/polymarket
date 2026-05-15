# TS Executor Phase A 验证说明

本目录用于执行 Phase A 的真实验证，目标是确认以下闭环已经跑通：

- 会话初始化
- L2 凭证派生
- 余额与 allowance 查询
- 查单
- 查成交
- 查持仓
- 撤单
- 状态落盘

## 1. 准备环境

建议在 PowerShell 中进入当前目录：

```powershell
cd c:\Users\Administrator\Documents\trae_projects\9527\polymarket\martingale_research\ts_executor
```

如未安装依赖，先执行：

```powershell
npm install
```

## 2. 配置环境变量

建议参考 `.env.example`，至少准备以下变量：

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER_ADDRESS`
- `POLYMARKET_WALLET_ADDRESS`
- `POLYMARKET_SIGNATURE_TYPE`
- `POLYGON_RPC_URL`

PowerShell 示例：

```powershell
$env:POLYMARKET_PRIVATE_KEY = "0xYOUR_PRIVATE_KEY"
$env:POLYMARKET_FUNDER_ADDRESS = "0xYOUR_FUNDER_ADDRESS"
$env:POLYMARKET_WALLET_ADDRESS = "0xYOUR_WALLET_ADDRESS"
$env:POLYMARKET_SIGNATURE_TYPE = "3"
$env:POLYGON_RPC_URL = "https://1rpc.io/matic"
```

如果您已经确认过当前账户模型，通常应满足：

- `walletAddress = EOA 地址`
- `funderAddress = deposit wallet 地址`
- `signatureType = 3`

## 2.1 EXE 配置模型

当前已经补充面向最终 EXE / GUI 的统一配置模型，推荐从示例文件开始：

```powershell
copy .\app_config.example.json .\app_config.json
npm run app-config -- validate
npm run app-config -- summary
```

支持的命令：

```powershell
npm run app-config -- init
npm run app-config -- validate
npm run app-config -- summary
npm run app-config -- env
npm run app-ui -- --config .\app_config.json
npm run app-gui -- --config .\app_config.json
npm run desktop -- --config .\app_config.json
npm run pack:win-dir
npm run dist:win-portable
npm run dist:win-nsis
npm run dist:win
```

说明：

- `app_config.json` 对应未来最终软件界面里的主要输入项
- 目前已经覆盖：
  - 钱包私钥
  - wallet / funder 地址
  - Polymarket / Polygon / Binance 网络地址
  - 策略目录
  - daemon 运行间隔
  - 风控阈值
  - Windows 计划任务名
- `summary` 会自动对私钥做脱敏展示
- `env` 默认输出脱敏后的环境映射，后续 GUI/EXE 可直接复用这层转换
- `app-ui` 会输出最终 EXE / GUI 可直接消费的聚合状态 JSON，包含 dashboard、config、runtime、logs 四块页面数据
- `app-gui` 会启动一个本地 Web 控制面，支持查看状态、编辑配置、执行 start/stop/restart/pause/resume，并可直接打开配置目录、日志目录、策略目录
- GUI 的“策略中心”会区分“当前运行中策略”和“下次启动生效策略”，并展示候选策略的 walk-forward 摘要与系统推荐结果
- GUI 的“重新扫描策略”会调用 `martingale_research/scripts/export_strategy_bundle.py`，按当前候选策略参数重生成 `allowed_states` 和 `walk_forward_summary`
- `desktop` 会启动 Electron 桌面壳，并自动拉起内置 GUI 服务
- `pack:win-dir` 会生成 `build_dist\win-unpacked\` 目录版，便于先做本地验证
- `dist:win-portable` 会生成便携版 `portable.exe`
- `dist:win-nsis` 会单独生成 NSIS 安装器，便于分开排查构建问题
- `dist:win` 会同时生成便携版和 NSIS 安装器
- `electron/build_windows.mjs` 会把 Electron 和 builder 缓存固定到项目 `runtime_state` 下，避免构建时写系统默认缓存目录
- 当前首版打包暂时关闭了 `asar`，优先保证 `Electron -> tsx -> gui_server.ts` 这条运行链稳定；后续可再优化成 `asar + asarUnpack`
- 当前还没有加入自定义 `icon.ico`，所以 Windows 包会先使用 Electron 默认图标；这不会阻塞功能验证

## 3. 帮助命令

```powershell
npm run lifecycle-demo -- --help
```

## 4. 验证模式 A：回查已有真实订单

如果您手里已经有一个真实 `orderID`，优先用这个模式。

```powershell
npm run lifecycle-demo -- --order-id 0xYOUR_ORDER_ID
```

建议第一条就用您之前已经真实成交过的订单做验证。

验证成功时，您应能看到：

- `session`
- `account_snapshot`
- `order_id`
- `mode order_lifecycle`

同时本地会生成或更新：

- `runtime_state/runtime_state_v2.json`
- `runtime_state/execution_events.jsonl`

## 5. 验证模式 B：新发一笔测试单

如果要发新单，请先准备一个有效的 `tokenID`。

```powershell
npm run lifecycle-demo -- --token-id TOKEN_ID --price 0.99 --size 2 --side BUY --order-type GTC
```

如果您希望脚本在查单后尝试撤单：

```powershell
npm run lifecycle-demo -- --token-id TOKEN_ID --price 0.99 --size 2 --side BUY --order-type GTC --cancel
```

说明：

- `--cancel` 只会在订单不是 `matched` 时尝试撤单
- 如果订单已经成交，脚本会保留订单状态与成交快照

## 6. 重点检查什么

建议您重点看以下内容：

- `session.walletAddress` 是否等于预期的 EOA 地址
- `session.funderAddress` 是否等于预期的 deposit wallet 地址
- `account_snapshot.collateralBalance` 是否有值
- `account_snapshot.allowance` 是否有值
- `execution_events.jsonl` 中是否出现以下事件：
  - `SESSION_READY`
  - `BALANCE_SNAPSHOT`
  - `ORDER_STATUS_UPDATED`
  - `TRADES_FETCHED`
  - `POSITION_SNAPSHOT`
  - `ORDER_CANCELLED`

## 7. Runtime 控制

当前已经提供最小运行时控制脚本，可查看状态、人工暂停、人工恢复：

```powershell
npm run runtime-control -- status
npm run runtime-control -- pause --code MANUAL_PAUSE --reason "Paused by operator"
npm run runtime-control -- resume --reason "Resume after review"
```

说明：

- `status` 会输出当前 `runtime_state_v2.json` 的暂停状态、最近 run 状态、订单状态和风控计数
- `pause` 会把运行时切到暂停态，并写入 `execution_events.jsonl`
- `resume` 会清除暂停态，供 `hourly-daemon` 或 `daemon-runner` 在下一个 tick 继续推进

## 8. Daemon 状态检查

当前还提供一个面向守护进程运维的状态入口：

```powershell
npm run daemon-status --
npm run daemon-status -- --stale-after-ms 180000
```

说明：

- `daemon-status` 读取 `daemon_heartbeat.json` 与 `runtime_state_v2.json`
- 会输出综合后的 `health`，包括 `never_started`、`running`、`sleeping`、`runtime_paused`、`stopped`、`error`、`stale`
- `--stale-after-ms` 用于定义多久没有更新心跳就判定为超时失联

## 9. Daemon 服务控制

当前还提供一个最小的服务控制脚本，用于后台启动、停止和查看状态：

```powershell
npm run daemon-service -- start --interval-ms 60000
npm run daemon-service -- start --execute
npm run daemon-service -- stop
npm run daemon-service -- status
npm run daemon-service -- restart --interval-ms 60000
npm run daemon-service -- start --config .\app_config.json
```

说明：

- `start` 会以 detached 后台进程方式启动 `daemon_runner`
- `stop` 会先写入 stop 文件请求优雅停机，超时后再强制终止
- `status` 复用 `daemon-status` 输出综合健康状态
- `--config .\app_config.json` 可直接把 EXE 配置模型接入运行层
- 运行时还会额外生成：
  - `runtime_state/daemon_runner.pid`
  - `runtime_state/daemon_runner.stdout.log`
  - `runtime_state/daemon_runner.stderr.log`
  - `runtime_state/daemon_runner.stop`

## 10. Windows 部署脚本

当前已经补充一套 PowerShell 脚本，适合在 Windows 服务器上直接运维：

```powershell
copy .\scripts\windows\env.local.example.ps1 .\scripts\windows\env.local.ps1
.\scripts\windows\start-daemon.ps1 -IntervalMs 60000
.\scripts\windows\status-daemon.ps1
.\scripts\windows\stop-daemon.ps1
.\\scripts\\windows\\restart-daemon.ps1 -IntervalMs 60000
.\\scripts\\windows\\tail-daemon-log.ps1 -Stream stdout -Tail 80
```

如果需要在登录后或开机后自动拉起，可安装计划任务：

```powershell
.\scripts\windows\install-daemon-task.ps1 -TaskName "PolymarketTsExecutorDaemon" -IntervalMs 60000
.\scripts\windows\uninstall-daemon-task.ps1 -TaskName "PolymarketTsExecutorDaemon"
```

说明：

- `daemon-common.ps1` 负责定位执行目录并按需加载 `scripts\windows\env.local.ps1`
- `start-daemon.ps1` / `stop-daemon.ps1` / `status-daemon.ps1` / `restart-daemon.ps1` 是对 `daemon-service` 的 Windows 包装
- `tail-daemon-log.ps1` 用于查看 stdout / stderr 日志，支持 `-Wait`
- `env.local.ps1` 不应提交真实私钥，仓库内仅保留 `env.local.example.ps1`
- `install-daemon-task.ps1` / `uninstall-daemon-task.ps1` 用于安装和卸载 Scheduled Task
- 如果根目录存在 `app_config.json`，这些 Windows 脚本会默认自动使用它；也可显式传 `-ConfigFile`

## 11. 当前已知限制

- `positions` 目前走 Data API 查询，后续可能再按真实返回结构继续收紧字段映射
- 还没有做自动轮询等待订单状态变化
- 还没有做测试文件
- `daemon-runner` 已经支持心跳文件，但还没有包装成真正的 Windows 服务
- 心跳文件目前主要服务于本地监控和后续 GUI 集成

## 12. 推荐验证顺序

推荐按下面顺序进行：

1. 先跑 `--help`
2. 再跑已有 `orderID` 的回查
3. 最后再跑一笔新的测试单
4. 如需守护运行，再跑 `npm run daemon-runner -- --max-ticks 1`
5. 跑 `npm run daemon-status --` 检查心跳与健康状态
6. 跑 `npm run daemon-service -- start` / `stop` 验证后台控制
7. 跑 `.\scripts\windows\start-daemon.ps1` / `status-daemon.ps1` / `stop-daemon.ps1` 验证 Windows 包装层
8. 跑 `.\scripts\windows\restart-daemon.ps1` 和 `tail-daemon-log.ps1` 验证运维补充脚本
9. 如需人工暂停/恢复，再使用 `npm run runtime-control -- ...`

如果已有 `orderID` 回查成功，说明当前 Phase A 主链路已经基本可用。
