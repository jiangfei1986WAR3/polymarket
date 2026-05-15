# Polymarket 马丁系统阶段性开发总结与下一阶段方案

日期：2026-05-13

---

## 一、本文档目的

本文档用于系统总结当前项目已经推进到什么阶段、今天开发过程中到底解决了哪些关键问题、哪些问题已经被确认不是核心阻塞、当前真正卡住的点是什么，以及下一阶段应该如何继续推进开发。

这份文档不是泛泛而谈的进度汇报，而是把今天整条排障链路完整梳理清楚，避免后续再次重复走弯路。

---

## 二、当前项目整体处于什么阶段

### 1. 研究与策略层

当前项目在“研究层”已经不再是概念验证，而是已经形成了较完整的研究闭环。

已完成内容包括：

- 基于 Binance `BTCUSDT` 1H K 线建立了策略信号输入源
- 已完成 6 步马丁模型的穷举回测框架
- 已完成 64 个 6 位 Up/Down pattern 的枚举与统计
- 已完成条件风险表 `conditional_risk_by_state` 的研究框架
- 已完成 train/test 切分与 walk-forward 方向的验证框架
- 已产出策略输出目录：
  - `strategy_outputs/2026-W20-main`
  - `strategy_outputs/2026-W20-conservative`
- 已生成：
  - `allowed_states.json`
  - `allowed_states.csv`
  - `strategy_config.json`
  - `walk_forward_summary.json`

这意味着：

### 当前项目的“策略研究层”已经基本成型

也就是说，项目不再停留在“到底做不做马丁、怎么做条件过滤”的阶段，而是已经拥有：

- 可重复的研究数据源
- 可重复的回测命令
- 可解释的风险筛选方法
- 可导出的策略配置产物

这部分后续更多是“持续迭代”和“定期滚动更新”，不是从零开始开发。

---

### 2. 执行与自动化层

当前项目的“执行层”已经从“最后一公里”进一步推进到：

## 已经完成真实自动化下单成功验证，进入实盘工程化阶段

更准确地说，执行层目前已经完成：

- Polymarket 公共数据读取
- 私钥与钱包模型识别
- L1/L2 鉴权实验
- 旧 Python SDK 路线验证
- 官方 TypeScript SDK v2 路线验证
- deposit wallet 路径识别
- deployed deposit wallet 的推导与验证
- 正确的 signature type 确认
- 正确的 funder 地址确认
- 真实 BTC 1H 市场 event / market / tokenID 提取
- deposit wallet 可交易余额入账验证
- 第一笔真实程序化订单成功下单并成交验证

目前还没有完成的，不再是“能不能下单”，而是：

- 订单生命周期管理闭环
- 动态市场定位模块
- 策略层和执行层正式对接
- daemon 化和异常恢复

因此执行层当前可以定义为：

## 自动化真实下单已经打通，下一阶段应转入订单管理与系统工程化

这意味着项目已经不再是“接入验证阶段”，而是已经拥有真实交易能力，后续开发重点应从“证明能不能下”切换为“如何稳定、持续、可控地运行”。

---

## 三、今天开发过程中最重要的结论

今天最重要的进展不是写了多少代码，而是把之前混乱的账户模型、资金模型、签名模型全部理顺后，最终完成了真实自动化下单成功验证。

### 最核心的结论如下：

#### 结论 1：Polymarket 确实支持自动化交易，而且当前账户已经成功打通

这一点现在已经不是猜测，而是已经被真实订单结果验证。

我们已经用：

- Python 官方 SDK 路线
- TypeScript 官方 SDK v2 路线
- deposit wallet 路线

反复验证过。

因此项目方向本身没有错：

### Polymarket 是支持程序化交易的，并且当前账户路径已经成功跑通

只是它的账户模型比普通交易所复杂得多。

---

#### 结论 2：问题不在“我们的代码太差”，而在“必须走对账户模型”

今天排查下来，已经明确排除：

- 不是单纯 Python SDK 老旧的问题
- 不是我们 bridge 封装写错的问题
- 不是单纯 API Key 创建失败的问题
- 不是普通 EOA 钱包完全不能用的问题
- 不是网页后台没开某个“自动化开关”
- 也不是“账户没资格自动化”这种模糊问题

真正的问题是：

## 必须使用 Polymarket 新资金路径和正确账户结构

---

#### 结论 3：当前正确账户结构已经被识别出来，并经真实成交验证通过

今天最终确认了三个关键身份：

### （1）EOA 签名地址

地址：`0xD5e4CcE75FD49274d0E28C4fF522f380905532E1`

这个地址的特点：

- 来自 OKX 钱包
- 用户持有私钥
- 可用于本地签名
- Relayer API Key 绑定的也是这个地址

它的角色不是最终交易 maker，而是：

## 底层签名者

---

### （2）Polymarket API / deposit wallet 地址

地址：`0x7Bd9870729b335269494F6E9F2bcE43E62C98a6f`

用户在网页个人资料中看到的提示是：

> 请勿向此地址发送资金。仅供 API 使用。

这个提示一开始非常迷惑，但今天已经确认：

## 这个地址不是装饰性地址，而是真正重要的交易层地址

进一步通过 SDK 验证后，已经确认：

### 它正是从 `0xD5e4...` 推导出来的 deployed deposit wallet

这一步意义非常大，因为它说明：

- Polymarket 并不是简单让用户拿 EOA 地址直接下单
- 它要求通过 deposit wallet 体系完成交易

---

### （3）真实交易身份模型

最终确认，当前这条链路的正确方向不是：

- signer = `0xD5e4...`
- funder = `0xD5e4...`
- signatureType = `0`

而是：

- signer = `0xD5e4...`
- funder = `0x7Bd9...`
- signatureType = `3 (Poly1271)`

这一点是今天最关键的技术突破，而且已经不只是“理论正确”，而是已经被真实成交结果验证。

---

#### 结论 4：真实可交易余额的关键不在网页展示值，而在 deposit wallet / CLOB balance

今天后半段的一个关键变化是：

- 用户从 OKX 给 Polymarket 再充值了 3 美元
- 重新检测后，`balanceAllowance.balance` 从 `0` 变为 `3000000`

这说明：

## 真正用于自动化下单的余额口径，是 deposit wallet / CLOB 可交易余额

而不是用户直觉中网页某个位置的展示余额。

这一步也彻底证明了之前一直卡住的根因是：

### 自动化交易余额没有真正入账，而不是权限、账户资格或 SDK 失效

---

#### 结论 5：第一笔真实程序化订单已经成功

最终在以下配置下，真实下单成功：

- signer: `0xD5e4CcE75FD49274d0E28C4fF522f380905532E1`
- funder / deposit wallet: `0x7Bd9870729b335269494F6E9F2bcE43E62C98a6f`
- signatureType: `3 (Poly1271)`
- market: `Bitcoin Up or Down - May 13, 8AM ET`
- tokenID: `75085498472520275254001058341803547063561598166717133714482267126565368231456`
- price: `0.99`
- size: `2`
- side: `BUY`
- orderID: `0x42b1ae78418d2c78a293ea9ef8fc523502a36857eba0915d33314c6d0a90b90c`
- transaction hash: `0x657ac062f78392fda7d1504fa9848e5afdc9aff430cbb23c89bd5f8baf38459a`

返回结果：

- `success = true`
- `status = matched`
- 有真实 `orderID`
- 有真实 `transactionsHashes`
- 返回的 `takingAmount = 2`
- 返回的 `makingAmount = 0.002`

这说明：

## 项目已经正式跨过“能否在 Polymarket 上自动化下单”这个最大技术门槛

这笔订单的实际意义不只是“接口返回成功”，而是：

- 后端接受了当前账户模型
- 当前余额路径被识别为有效可交易余额
- 当前 market / tokenID 被识别为真实有效交易标的
- 订单已经进入真实成交路径，而不是停留在本地签名或接口预检阶段

因此，这笔订单可以作为当前阶段最重要的实盘验证凭证。

---

## 四、今天遇到的所有疑难杂症，以及最后是怎么解决的

下面按排障顺序总结今天遇到的关键问题。

---

### 问题 1：为什么网页账户里明明有钱，但 SDK 查到余额是 0？

#### 表现

- Polymarket 网页中能看到账户余额
- 但 SDK `balance_allowance(COLLATERAL)` 一直返回 0
- Python 路线如此
- TypeScript 路线也是如此

#### 一开始的误判

最开始容易以为是：

- allowance 没更新
- SDK bug
- funder 地址填错
- signature type 不对

这些都试过，但不能彻底解释问题。

#### 最后结论

问题的本质是：

## 网页可见余额 ≠ 当前 CLOB 认可的可交易 maker 余额

Polymarket 的资金模型不是“钱包里有 USDC 就直接可交易”，而是：

- EOA 钱包
- API / profile / deposit wallet
- pUSD / collateral / allowance
- CLOB maker 余额

这是一个多层结构。

#### 怎么解决

最终不是通过“多试几次 allowance”解决的，而是通过：

- 识别正确的 deposit wallet
- 识别正确的 funder
- 切换到正确的 signature type

才真正推进。

---

### 问题 2：为什么一直报 `maker address not allowed, please use the deposit wallet flow`？

#### 表现

这是今天最核心、最反复出现的报错：

```text
maker address not allowed, please use the deposit wallet flow
```

#### 一开始的误判

一开始可能会理解成：

- 账户没权限
- 网页后台没开自动化
- EOA 模式不支持
- 邮箱账户有 bug

#### 最后结论

这个报错的真正意思是：

## 你当前传给后端的 maker/funder 地址，不是 Polymarket 认可的交易钱包路径

它不是在说“不能自动化”，而是在说：

### 你必须走 deposit wallet flow

#### 怎么解决

最后我们通过多轮实验，定位出正确链路：

- 不能直接用 EOA 地址作为 maker
- 必须找出 deployed deposit wallet
- funder 必须切换到 deposit wallet 地址
- signature type 必须切换到 Poly1271

直到走到这一步，这个报错才真正消失。

这说明：

### 今天最困难的根因问题已经被解决

---

### 问题 3：`0x7Bd9...` 这个“仅供 API 使用”的地址到底是什么？

#### 表现

用户在网页个人资料中看到：

- 一个地址
- 页面明确写“请勿向此地址发送资金，仅供 API 使用”

这会导致直觉上以为：

- 这只是展示地址
- 没有实际作用
- 不是资金地址

#### 最后结论

今天的结果证明：

## 这个地址非常重要，它不是装饰地址，而是系统里的真实交易身份地址

进一步通过 deposit wallet 检查脚本确认：

### 它就是从用户 EOA 地址推导出的 deployed deposit wallet

#### 怎么解决

解决方式不是“文档解释”，而是直接实测：

- 用 builder-relayer-client 推导 deposit wallet
- 检查是否已部署
- 最终发现它和网页 API 地址一致

这一步等于把网页展示层和链上真实结构对上了。

---

### 问题 4：到底该用哪种 signature type？

#### 表现

我们前面试过多种签名类型：

- `0 = EOA`
- `1 = POLY_PROXY`
- `2 = GNOSIS_SAFE`
- 最后聚焦 `3 = POLY1271`

#### 一开始的误判

一开始会觉得 signature type 只是个参数细节，但今天证明它不是细节，而是账户模型的核心组成部分。

#### 最后结论

对于当前这条 deposit wallet 路线：

## 正确的 signature type 是 `3 (Poly1271)`

只有当：

- funder = deployed deposit wallet
- signatureType = 3

两者同时成立时，后端才不再返回 `maker address not allowed`。

#### 怎么解决

最终通过官方文档、官方 Rust SDK PR、官方 TS SDK 路线推理以及实测，确认了这一点。

---

### 问题 5：Relayer API Key 到底有没有用？

#### 表现

用户已经在网页里创建了：

- Relayer API Key
- 对应地址 `0xD5e4...`

但一开始我们误以为还缺 secret/passphrase 等三件套。

#### 最后结论

今天进一步确认：

- 网页里可见的 Relayer API Key 说明这条账户确实已经进入新 relayer 体系
- 但仅靠它本身还不足以完成普通 CLOB 下单
- 真正关键的不是“拿它直接发请求”，而是它间接证明：

## 当前账户模型已经是 relayer / deposit wallet 体系，不是普通 EOA 体系

#### 怎么解决

不是靠把 Relayer API Key 直接塞进旧脚本，而是通过它帮助我们确认当前正确的系统架构方向。

---

### 问题 6：为什么换了官方 TypeScript SDK，问题还没消失？

#### 表现

我们从 Python 切到了 TypeScript 官方 client v2，希望绕过旧 SDK 坑。

#### 一开始的期待

一开始以为：

- 可能 Python SDK 旧
- TS 官方 client 能直接成功

#### 最后结论

切到 TS 官方 client 的真正价值，不是“立刻成功下单”，而是：

## 证明问题不在我们封装，而在 Polymarket 的账户与资金路径

也就是说，TS 路线虽然没有立刻成功下单，但它帮我们排除了大量错误假设。

#### 怎么解决

最后依然是在 TS 路线上继续推进 deposit wallet、signature type、funder 模型，才取得本质突破。

---

### 问题 7：为什么最后又出现新的报错 `orderbook does not exist`？

#### 表现

在彻底打通 deposit wallet 路径后，旧错误消失，出现了新错误：

```text
the orderbook ... does not exist
```

#### 最后结论

这个报错的意义非常正面。

它说明：

- 账户模型已经正确
- funder 已经正确
- signature type 已经正确
- allowance 也已经生效
- 现在不再是账户问题，而只是：

## 测试用的 tokenID / orderbook 选错了

这是一个完全不同层级的问题，而且比之前简单很多。

#### 怎么解决

需要从当前真实活跃市场中，拿到一个正在交易的、有效的 `clobTokenId`，然后再做最小下单测试。

---

### 问题 8：为什么已经找到正确 tokenID 后，又报 `not enough balance / allowance`？

#### 表现

当我们已经修正：

- signer
- funder
- signatureType
- tokenID

之后，新的报错变成：

```text
not enough balance / allowance: the balance is not enough -> balance: 0
```

#### 最后结论

这一步的意义非常重大，因为它说明：

- 旧的账户模型错误已经消失
- 现在系统已经愿意按正确交易路径受理订单
- 唯一剩余问题就是：

## deposit wallet 的真实可交易余额仍然为 0

#### 怎么解决

用户从 OKX 再向 Polymarket 充值 3 美元后，重新检测得到：

```json
"balance": "3000000"
```

即真实可交易余额已变为 `3.0` 美元。

这一步彻底证明：\n
### 之前失败不是权限问题，而是资金还没有真正进入自动化交易余额

---

### 问题 9：为什么余额有了以后，又报 `invalid amount for a marketable BUY order ($0.99), min size: $1`？

#### 表现

当 deposit wallet 余额已经入账后，新的错误变成：

```text
invalid amount for a marketable BUY order ($0.99), min size: $1
```

#### 最后结论

这说明：

- 账户结构是对的
- 余额已经入账
- allowance 已经生效
- 市场和 token 也已经正确

现在系统拒绝订单的唯一原因，是：

## 测试订单金额没有达到最小下单门槛

#### 怎么解决

我们把测试参数从：

- `price = 0.99`
- `size = 1`

调整为：

- `price = 0.99`
- `size = 2`

对应订单金额 `$1.98`，从而满足最小要求。

---

### 问题 10：最后这笔真实订单到底是怎样成功的？

#### 表现

在满足以下条件后：

- 已找到真实市场链接
- 已提取真实 tokenID
- 已确认 tickSize / negRisk
- 已确认 deposit wallet 有可交易余额
- 已将订单金额提升到最小门槛以上

重新提交订单。

#### 最后结果

返回：

```json
{
  "orderID": "0x42b1ae78418d2c78a293ea9ef8fc523502a36857eba0915d33314c6d0a90b90c",
  "status": "matched",
  "success": true,
  "transactionsHashes": [
    "0x657ac062f78392fda7d1504fa9848e5afdc9aff430cbb23c89bd5f8baf38459a"
  ]
}
```

#### 最终意义

这不是“模拟成功”，而是：

## 第一笔真实自动化下单已经成功，且真实成交

## 五、今天到底解决了哪些问题

如果从项目推进的角度看，今天不是“零碎修 bug”，而是一次架构级梳理。

### 已解决事项

#### 1. 已确认 Polymarket 确实支持自动化交易

项目方向成立。

#### 2. 已确认当前账户并非普通 EOA 直下单模型

必须走 deposit wallet 模型。

#### 3. 已确认真实的 signer 地址

`0xD5e4...`

#### 4. 已确认真实的 deployed deposit wallet 地址

`0x7Bd9...`

#### 5. 已确认正确的 signature type

`3 = Poly1271`

#### 6. 已确认正确的 funder 不是 EOA，而是 deployed deposit wallet

#### 7. 已确认旧报错 `maker address not allowed` 的根因并已被解决

#### 8. 已确认真实 BTC 1H 市场的 event / market / tokenID 提取方法

#### 9. 已确认 deposit wallet 余额入账才是自动化交易可用余额的真实口径

#### 10. 已确认订单最小金额门槛约束，并已用正确参数绕过

#### 11. 已完成第一笔真实自动化下单并成功 matched

也就是说，今天把整个项目最难的执行接入问题，从“未知大坑”推进到了：

## 真实交易能力已经成立，接下来转入工程化开发

---

## 六、当前代码层已经形成的新增资产

今天除了结论之外，还新增了执行层的关键验证资产。

### 1. Python 侧验证脚本

位于：
- `martingale_research/scripts/test_okx_wallet_eoa.py`
- `martingale_research/scripts/test_okx_wallet_eoa_order.py`
- `martingale_research/scripts/check_onchain_balance.py`

这些脚本记录了从 EOA 直连思路到 deposit wallet 之前的完整试错过程。

### 2. TypeScript 探针环境

位于：
- `martingale_research/ts_probe/package.json`
- `martingale_research/ts_probe/tsconfig.json`
- `martingale_research/ts_probe/src/probe.ts`
- `martingale_research/ts_probe/src/deposit-wallet-check.ts`

这套目录的意义很大：

- 它不是一次性的临时代码
- 而是未来继续推进 Polymarket 执行层时的最小验证环境
- 后续所有 deposit wallet / 下单 / 批量下单 / 真实策略接入，都应优先在这里继续演进

当前这套 TS 探针已经具备：

- 切换 tokenID
- 切换 signer / funder / signatureType
- 读取 balanceAllowance
- 读取 tickSize / negRisk
- 提交真实测试订单

因此它不再只是“验证脚本”，而是：

## 后续执行层正式开发的种子环境

### 3. execution 层桥接代码已被验证出边界

位于：
- `src/martingale_research/execution/polymarket_session.py`
- `src/martingale_research/execution/polymarket_trading.py`
- 以及相关 adapter/client 封装

这些 Python 代码并没有完全失去价值，但今天已经验证出：

## 若要继续做真实 Polymarket 自动化交易，执行层核心更适合逐步迁移到 TS 探针或在 TS 层完成关键能力验证后再回灌 Python

---

## 七、当前项目还没有完成的部分

虽然已经取得重大进展，并且已经完成首笔真实自动化下单成功验证，但当前项目还不能算“已具备稳定实盘能力”。

尚未完成的部分包括：

### 1. 自动化下单成功后的完整闭环验证

包括：

- 查询订单状态
- 查询成交状态
- 查询持仓
- 查询撤单
- 查询余额变化

### 2. 动态市场定位模块

目前我们虽然已经拿到了真实 BTC 1H 市场 tokenID，但仍然是依赖人工提供 event 链接。

后续必须做成程序自动定位：

- 当前小时的 BTC Up or Down event
- 当前 market
- YES/NO tokenIDs
- tickSize
- negRisk
- 市场开始/结束时间

这是实盘守护运行前的必备模块。

### 3. 把研究层输出和执行层对接起来

还没有把：

- `allowed_states`
- `strategy_config`
- `decision_engine`

真正驱动到 TS 执行端下单。

### 4. 周期性实盘守护逻辑

例如：

- 每小时轮询
- 每小时判定 signal
- 是否允许开新仓
- 连亏等级推进
- 持仓状态同步
- 异常恢复

### 5. 风控和异常防护

例如：

- 下单失败重试
- 余额不足处理
- 网络异常恢复
- 市场关闭/过期检查
- 订单簿不存在的降级处理

### 6. 交易后状态与账务一致性校验

需要补充：

- 订单状态与交易状态的对应关系
- matched 后是否一定持仓成功
- 持仓数据与 Data API / CLOB API 的一致性
- 余额变化与手续费表现

### 7. GUI 层

目前完全还没开始，只保留在未来规划中。

---

## 八、当前项目最合理的阶段定义

综合来看，当前项目可以定义为：

# 阶段：策略闭环已完成，执行链路已完成真实下单验证，进入工程化开发阶段

更精确地说：

### 研究层：80% - 90% 完成

### 执行层：已经跨过账户模型、deposit wallet、余额入账和首单成交验证阶段

### 实盘闭环：已完成首笔真实下单，但尚未完成完整订单管理与守护逻辑

所以这已经不是“冲击首笔订单”的阶段，而是：

## 已经进入可以正式建设稳定自动化交易系统的阶段

---

## 九、下一阶段开发方案

下面给出最推荐的下一阶段实施方案。

---

### 阶段 A：补全真实交易闭环

#### 目标

在已经完成首笔真实下单成功的基础上，补全订单生命周期管理。

#### 任务清单

1. 根据现有真实订单 `orderID` 查询订单状态
2. 查询成交记录 / trades
3. 查询 positions
4. 查询余额变化
5. 测试撤单
6. 测试再次下单
7. 记录一笔完整交易生命周期

#### 阶段完成标准

- 能下单
- 能看单
- 能查成交
- 能确认资金变化
- 能撤单或管理未成交订单

---

### 阶段 B：构建动态市场定位模块

#### 目标

摆脱人工提供网页链接，自动发现当前有效的 BTC 1H 市场。

#### 任务清单

1. 读取当前时间并转换到 ET
2. 查询 `btc-up-or-down-hourly` 系列
3. 自动筛选当前活跃 event
4. 提取 market、tokenIDs、tickSize、negRisk
5. 形成稳定可复用的 `market_locator`

#### 阶段完成标准

- 不依赖人工链接
- 每小时都能自动找到正确市场
- 市场缺失时能优雅跳过

---

### 阶段 C：把策略信号接入执行层

#### 目标

让研究层产物真正驱动执行层。

#### 任务清单

1. 读取 `strategy_outputs/.../strategy_config.json`
2. 读取 `allowed_states.json`
3. 用最新 Binance 1H K 线计算当前 state
4. 判断当前 state 是否允许开仓
5. 根据马丁等级决定 stake
6. 映射到 Polymarket 当前对应 1H 市场
7. 自动下单

#### 阶段完成标准

- 系统能根据最新 1H 状态自动决定是否交易
- 系统能使用策略配置自动形成订单

---

### 阶段 D：构建实盘守护进程

#### 目标

形成真正可连续运行的半自动或全自动交易 daemon。

#### 任务清单

1. 每小时触发
2. 同步市场
3. 同步账户状态
4. 同步持仓
5. 生成决策
6. 交易执行
7. 写入状态文件
8. 异常恢复

#### 阶段完成标准

- 可本地持续运行
- 可中断恢复
- 可记录全部关键状态

---

### 阶段 E：GUI / Windows 工具层

#### 目标

把策略和执行以可视化形式交付。

#### 任务清单

1. 账户状态展示
2. 当前 signal 展示
3. 当前马丁等级展示
4. 允许/禁止交易状态展示
5. 下单日志展示
6. 手动接管按钮

这一阶段排在执行闭环稳定之后，不建议提前开始。

---

## 十、接下来最推荐的具体动作顺序

如果按最现实、最节省时间的顺序，建议如下：

### 第一步
先完成：

## 订单管理闭环（查单 / 成交 / 持仓 / 撤单 / 余额）

### 第二步
完成：

## 动态 BTC 1H 市场定位模块

### 第三步
把：

## 研究层 `allowed_states` 与执行层打通

### 第四步
完成：

## daemon 与异常恢复

### 第五步
最后再考虑：

## GUI 和交付层

---

## 十一、补充研究方向：爆仓后条件风险研究

在当前主线已经明确为“订单管理闭环 + 动态市场定位 + 策略接入执行层 + daemon 化”的前提下，可以补充一个**研究层增强方向**，用于回答一个非常现实的问题：

> 如果某套策略刚刚发生一次 6 步马丁爆仓，接下来短期内是不是更危险？系统是否应该增加冷却、收紧过滤或其他保护动作？

这个方向的价值在于：

- 它不是拍脑袋增加规则，而是先用历史数据验证“爆仓后短期风险是否真的上升”
- 它和当前已有的条件风险研究框架（state -> future blowup risk）是同一路线，能够自然延伸
- 如果研究结果显著，可以把它回灌成执行层风控，不必盲目引入更激进的资金管理变化

### 11.1 研究目标

这项研究优先回答以下问题：

1. 一次爆仓之后，未来 `6 / 12 / 24 / 72` 小时再次爆仓的概率是否明显升高？
2. 爆仓之后，不同 `state` 的风险排序是否会发生变化？
3. 如果爆仓后风险确实上升，系统更适合：
   - 暂停若干小时（冷却）
   - 继续交易，但只允许更严格的一部分 `allowed_states`
   - 继续交易，但降低力度
4. 是否存在某些 pattern 在“爆仓后恢复期”表现特别差，从而需要专门限制？

### 11.2 第一阶段：只做研究，不改实盘主逻辑

建议先只做研究层验证，不立刻把任何新规则接入实盘。具体包括：

- 统计每套 pattern 在发生一次 `level6` 爆仓后：
  - `p(level6 again within next 6h)`
  - `p(level6 again within next 12h)`
  - `p(level6 again within next 24h)`
  - `p(level6 again within next 72h)`
- 统计爆仓后的 `TTF`（time-to-first）：
  - 距离下一次爆仓平均还有多少小时
  - 中位数是多少
- 统计“爆仓后 + 当前 6 根 state”这一组合下的条件风险：
  - 例如平时 `DDUUUU` 风险不高，但“刚爆仓后”的 `DDUUUU` 是否变危险

这一步的意义是先确认：

## 爆仓后到底是不是“高风险恢复期”

如果统计上根本不成立，就不应继续往系统里加新规则。

### 11.3 第二阶段：只测试保守控制，不直接引入重注

如果研究结果支持“爆仓后短期风险确实上升”，建议优先测试以下保守控制方案：

- **方案 A：爆仓后冷却**
  - 爆仓后暂停 `6 / 12 / 24` 小时不交易
- **方案 B：爆仓后收紧过滤**
  - 爆仓后只允许更低风险的一部分 `allowed_states`
- **方案 C：爆仓后降低力度**
  - 爆仓后新一轮虽然仍可启动，但先降低 base stake 或减少攻击性

这些方案的共同特点是：

- 与当前系统兼容
- 不会直接破坏现有的马丁定义
- 更适合先做样本内 / 样本外 / walk-forward 对比

### 11.4 当前不建议直接做的事情

虽然直觉上会出现一种想法：

> 如果历史上“爆仓后接下来几步没再爆过”，那是不是可以不跑马丁，而是改成几笔重注？

这个方向**暂不建议直接接入当前系统**，原因如下：

- “历史上没出现过”不等于“未来肯定不会发生”
- 这已经不是给现有策略加一个小筛选，而是在引入一套新的资金管理策略
- 一旦改成“爆仓后几笔重注”，就必须把它视为一套全新的系统，重新回测、重新做样本外验证

因此当前更稳妥的原则是：

## 先研究爆仓后的条件风险，再决定是否加冷却或更严格过滤；不直接用“重注反打”替代现有马丁逻辑

### 11.5 未来如果要正式落地，建议的实施顺序

1. 新增研究脚本，输出“爆仓后再爆风险”与“爆仓后 state 风险表”
2. 对比原系统与“爆仓后冷却 / 收紧过滤 / 降低力度”几套方案的样本外表现
3. 如果某套方案在：
   - 总爆仓次数
   - 最大回撤
   - 总收益
   三项上都有明显优势，再考虑接入执行层
4. 若未来仍想研究“爆仓后重注”路径，必须作为**独立策略分支**重新建模和回测，而不是直接插入当前主系统

这个补充方向目前定义为：

## 有研究价值，但优先级低于当前主线修复与工程化任务

---

## 十二、最终总结

如果只用一句话总结今天到目前为止的全部进展，那就是：

# 我们已经不仅拆开了 Polymarket 自动化交易接入中最难的账户模型问题，而且已经用真实市场、真实余额、真实订单完成了第一笔自动化成交验证。

我们已经确认：

- Polymarket 支持自动化交易
- 用户当前账户可以走程序化路径
- 正确 signer 已找到
- 正确 deposit wallet 已找到
- deposit wallet 已部署
- 正确 signature type 已找到
- `maker address not allowed` 这一最难报错已经被解决
- 自动化交易余额入账路径已经被验证
- 真实 BTC 1H 市场的 token 获取路径已经跑通
- 第一笔真实自动化订单已经成功 `matched`

所以当前项目已经不再停留在“研究+接入验证”阶段，而是：

# 已经正式进入实盘工程化开发阶段

接下来的开发重点，不应再重复研究权限与账户模型，而应集中火力完成：

## 订单管理闭环 + 动态市场定位 + 策略接入执行层 + daemon 化

这几步完成后，项目就会从“能真实自动下单”进化为“能稳定运行的自动化交易系统”。
