# Polymarket 邮箱账户模式兼容设计文档

日期：2026-05-17

> 用途：
> - 本文档用于把“当前 EOA 钱包模式主系统”扩展为“EOA 钱包模式 + Polymarket 邮箱账户模式并存”的正式设计方案。
> - 它不是泛泛讨论，而是直接对应当前仓库里 `martingale_research/ts_executor` 的现有实现。
> - 目标是在**不破坏当前钱包模式**的前提下，为后续邮箱账户自动化验证和正式接入提供明确改造路径。

---

## 1. 设计目标

当前系统已经具备：

- 基于 `privateKey / walletAddress / funderAddress / signatureType` 的钱包模式运行能力
- `ts_executor` 主执行链路
- GUI / daemon / runtime_state / strategy bundle / auto redeem 基础骨架

本次设计的目标不是重做系统，而是新增一层可控兼容：

- 保留当前 `eoa` 模式
- 新增 `poly_proxy` 模式
- 让两种模式共享同一套：
  - 策略选择
  - 市场定位
  - 下单执行
  - 对账
  - daemon
  - GUI
  - 风控

核心原则：

- 不破坏当前已验证的主下单链路
- 不让 research-only 脚本侵入正式执行系统
- 不把邮箱模式写成单独平行系统
- 优先抽象“账户解析层”，而不是到处写分支判断

---

## 2. 当前系统现状

### 2.1 当前已存在的账户模型

当前 `ts_executor` 的配置和会话解析，本质上都是围绕以下字段运作：

- `privateKey`
- `walletAddress`
- `funderAddress`
- `signatureType`
- `relayerApiKey`

相关代码：

- `martingale_research/ts_executor/src/app_config.ts`
- `martingale_research/ts_executor/src/types.ts`
- `martingale_research/ts_executor/src/auth.ts`
- `martingale_research/ts_executor/src/client.ts`

当前系统默认假设：

- 用户能提供一把本地可签名私钥
- `walletAddress` 是签名身份
- `funderAddress` 是实际 maker / deposit wallet 路径
- `signatureType` 已明确

这意味着：

- 当前执行层其实已经接近“通用 signer 配置系统”
- 并不是死绑定某个特定钱包 UI

### 2.2 当前缺少的能力

当前还没有正式落地的，是“账户模式”的抽象。

也就是说：

- 代码里已有 signer/funder 结构
- 但还没有明确的 `accountMode`
- GUI 也没有把账户来源区分成“钱包模式 / 邮箱模式”
- 自动回款链路也还没有为邮箱模式做专门验证分支

因此下一步最合理的改法，不是推翻配置，而是：

- 在现有配置模型上增加一层账户模式抽象

---

## 3. 本次推荐的正式模型

### 3.1 新增 `accountMode`

建议在正式配置中新增：

```json
{
  "account": {
    "accountMode": "eoa"
  }
}
```

支持值：

- `eoa`
- `poly_proxy`

说明：

- `eoa` 表示当前已验证通过的外部钱包私钥模式
- `poly_proxy` 表示未来 Polymarket 邮箱账户导出私钥后的自动化模式

### 3.2 为什么不用直接替换旧字段

不建议直接把：

- `walletAddress`
- `funderAddress`
- `signatureType`

换成另一套完全不同的配置结构。

原因：

- 当前代码大量依赖这些字段
- 订单、会话、日志、GUI、状态文件都围绕这些字段展开
- 邮箱模式本质上仍然需要落到统一 signer/funder/signatureType 组合

因此正确方向应该是：

- 上层增加 `accountMode`
- 下层仍输出统一 `ResolvedAccountContext`

---

## 4. 推荐的数据结构改法

### 4.1 `ExecutorAppConfig` 建议新增结构

建议在 `martingale_research/ts_executor/src/types.ts` 中把配置扩展为：

```ts
account: {
  accountMode: "eoa" | "poly_proxy";
  label: string;
  notes: string;
}
```

现有 `credentials` 保留：

```ts
credentials: {
  privateKey: string;
  walletAddress: string;
  funderAddress: string;
  signatureType: SignatureType;
}
```

说明：

- `account.accountMode` 用于声明模式
- `credentials.*` 继续作为统一执行参数
- GUI 可显示 `label / notes`
- 后续如确有需要，再扩展邮箱专用辅助字段

### 4.2 暂不建议新增过多邮箱专属字段

第一阶段不建议一上来增加很多类似：

- `proxyFactoryAddress`
- `emailAccountId`
- `exportedFrom`
- `proxySignerType`

这样的复杂配置。

原因：

- 当前还没完成邮箱账户的真实最小链路验证
- 提前设计太多专用字段，容易造成假抽象

第一阶段建议只保留：

- `accountMode`
- 统一后的 `privateKey / walletAddress / funderAddress / signatureType`

如果邮箱模式验证后发现还必须补专用字段，再二期扩展。

---

## 5. 需要新增的运行时抽象

### 5.1 新增 `ResolvedAccountContext`

建议在 `ts_executor` 内部新增一个统一账户解析结果结构，例如：

```ts
interface ResolvedAccountContext {
  accountMode: "eoa" | "poly_proxy";
  privateKeyPresent: boolean;
  walletAddress: `0x${string}`;
  funderAddress: `0x${string}`;
  signatureType: SignatureType;
  derivedDepositWallet?: `0x${string}`;
  apiCreds: {
    key: string;
    secret: string;
    passphrase: string;
  };
  diagnostics: {
    usedConfiguredFunder: boolean;
    derivedFunderMatchesConfigured: boolean | null;
    modeNote: string;
  };
}
```

### 5.2 这个结构的作用

作用是把：

- 配置读入
- 模式判断
- 地址推导
- API key 派生
- funder 校验

集中在一处完成。

然后其它模块只认这一层，不再关心：

- 当前到底是钱包模式
- 还是邮箱模式

这样能保证：

- `client.ts`
- `orders.ts`
- `execution_reconciler.ts`
- `hourly_daemon_demo.ts`
- `auto_redeem.ts`

都尽量不被模式差异污染。

---

## 6. 代码改造方案

### 6.1 `types.ts`

目标：

- 为配置和会话层加上 `accountMode`
- 引入统一账户解析结果类型

建议改动：

- 给 `ExecutorAppConfig` 新增 `account`
- 给 `AppUiState` 增加 `accountMode`
- 给 `SessionContext` 增加 `accountMode`
- 新增 `ResolvedAccountContext`

### 6.2 `app_config.ts`

目标：

- 让 `app_config.json` 能声明账户模式
- 默认仍为 `eoa`

建议改动：

- `makeDefaultAppConfig()` 里新增：
  - `account.accountMode = "eoa"`
  - `account.label = "default-eoa-profile"`
  - `account.notes = ""`
- `loadAppConfig()` 做兼容合并
- `validateAppConfig()` 校验 `accountMode` 只能是 `eoa | poly_proxy`
- `summarizeAppConfig()` 输出账户模式
- `buildEnvOverridesFromAppConfig()` 增加例如：
  - `POLYMARKET_ACCOUNT_MODE`

### 6.3 `auth.ts`

这是本次改造最核心的位置。

目标：

- 把“账户模式判断”和“最终 signer/funder 解析”集中到这里

建议新增内部函数：

- `resolveConfiguredAccountMode(config)`
- `resolveWalletModeContext(config)`
- `resolveEmailProxyModeContext(config)`
- `validateResolvedAddresses(resolved)`

推荐流程：

1. 读取 `accountMode`
2. 根据模式走不同解析函数
3. 统一产出 `ResolvedAccountContext`
4. 用统一结果创建 `SessionContext`

第一阶段里，两种模式都可以先共用大部分逻辑：

- 都从私钥导出签名地址
- 都尝试派生 API key
- 都尝试推导 deposit wallet
- 都对比：
  - 配置的 `funderAddress`
  - 推导出的 deposit wallet

不同点主要是：

- `eoa` 模式：把当前配置视为外部钱包私钥路径，优先保留当前已稳定运行的老模式
- `poly_proxy` 模式：在日志和诊断中明确标记这是 Polymarket 邮箱账户导出私钥路径，并为后续 proxy funder 校验预留兼容位

换句话说：

- 第一阶段的邮箱模式重点不是写完全不同的交易逻辑
- 而是先把模式“纳入正式系统”

### 6.4 `client.ts`

目标：

- 尽量不改或少改

建议：

- 继续只认统一 `SessionContext`
- 不要在这里写 `if (accountMode === ...)`

### 6.5 `auto_redeem.ts`

目标：

- 为邮箱模式增加专门的兼容校验与日志说明

建议补的不是新回款算法，而是：

- 在执行回款前记录当前 `accountMode`
- 若为 `poly_proxy`，额外输出：
  - 当前使用的 `walletAddress`
  - 当前使用的 `funderAddress`
  - relayer 是否完整
  - deposit wallet 是否已部署
- 若邮箱模式下发现 `executeDepositWalletBatch()` 不兼容，再在这里引入单独适配层

当前阶段建议先不改主回款路径，只加：

- 更明确的模式日志
- 更严格的兼容失败提示

### 6.6 `hourly_daemon_demo.ts`

目标：

- 让守护执行过程对账户模式可见，但不被模式分支淹没

建议：

- 在 tick 开始日志、会话快照、错误日志中补充 `accountMode`
- 当 `poly_proxy` 模式运行时，把关键事件写清楚：
  - `SESSION_READY`
  - `BALANCE_SNAPSHOT`
  - `DAEMON_ORDER_POSTED`
  - `AUTO_REDEEM_STATUS`

不建议：

- 在主下单逻辑中大量插入模式判断

### 6.7 `gui_server.ts` / `app_ui_state.ts`

目标：

- GUI 明确展示当前账户模式
- 配置页允许切换模式

建议新增显示：

- 当前账户模式：`eoa` / `poly_proxy`
- 当前签名地址
- 当前 funder 地址
- 当前 signature type
- 当前模式提示说明

建议新增表单字段：

- `accountMode`
- `label`
- `notes`

建议新增提示文案：

- `eoa` 模式：当前已验证主链路
- `poly_proxy` 模式：建议先用测试账户做小额验证

### 6.8 `runtime_state` 与日志

目标：

- 让运行期产物能追踪“这次到底是哪个账户模式在跑”

建议：

- `runtime_state_v2.json` 的 `session` 段加 `accountMode`
- `execution_events.jsonl` 关键事件里补 `accountMode`

这会直接提升：

- 排障能力
- 多环境切换时的可解释性

---

## 7. 推荐的阶段化实施顺序

### 阶段 A：只引入模式抽象，不改变交易逻辑

任务：

- 扩展 `types.ts`
- 扩展 `app_config.ts`
- 扩展 `auth.ts`
- 扩展 GUI 配置展示
- 扩展日志与 runtime_state

完成标准：

- 系统能读取 `accountMode`
- GUI 能显示 `accountMode`
- runtime/log 中能追踪 `accountMode`
- 钱包模式回归不受影响

### 阶段 B：邮箱模式最小验证

任务：

- 新建测试邮箱账户
- 导出私钥
- 填入 `app_config.json`
- 用 `poly_proxy` 模式跑：
  - session ready
  - balance snapshot
  - market locator
  - lifecycle demo 小额订单

完成标准：

- 邮箱模式能完成只读和最小下单验证
- 能拿到明确可复现的 signer/funder/signatureType 组合

### 阶段 C：邮箱模式自动回款兼容验证

任务：

- 复用现有 `auto_redeem.ts`
- 验证邮箱模式下：
  - deposit wallet 是否一致
  - relayer header 是否正常
  - executeDepositWalletBatch 是否成功

完成标准：

- 邮箱模式下回款链路要么直接通过
- 要么明确定位到具体兼容点

### 阶段 D：正式接入 daemon 与 GUI 主运行链

任务：

- 把邮箱模式纳入实际守护运行流程
- 补充更多状态提示和异常提示

完成标准：

- `eoa` / `poly_proxy` 都能作为正式配置运行
- GUI 对两种模式均有清晰展示

---

## 8. 验证清单

### 8.1 配置层验证

- `app_config.json` 能保存 `accountMode`
- `validate` 能识别非法模式值
- `summary` 能脱敏展示当前模式与地址

### 8.2 会话层验证

- `eoa` 模式仍能正常：
  - 派生 API key
  - 解析 funder
  - 创建 trading client
- `poly_proxy` 模式能完成同样步骤

### 8.3 交易层验证

- `lifecycle-demo` 能在 `poly_proxy` 模式下跑通已有订单回查
- 能完成一笔小额测试单
- 能回查订单状态 / trades / positions

### 8.4 回款层验证

- 赢单后能识别待回款市场
- 能正确判断 closed / position size / relayer credentials
- 能提交或给出明确失败原因

### 8.5 守护运行验证

- `daemon-runner` 能在两种模式下正常写心跳
- `runtime-control` 暂停/恢复不受模式影响
- `daemon-service` 后台启动控制不受模式影响

---

## 9. 风险与边界

### 9.1 不要低估邮箱账户私钥权限

邮箱账户导出的私钥，依然应按高风险热钱包私钥处理。

因此：

- 不应提交到仓库
- 不应长时间明文存盘
- 不应和主钱包资产混用

### 9.2 不要让邮箱模式破坏钱包模式

这是本次设计最重要的工程边界。

如果出现下面任一迹象，应停止继续堆功能：

- 钱包模式回归被破坏
- `auth.ts` 中模式分支越来越散
- `client.ts` / `orders.ts` / `hourly_daemon_demo.ts` 到处都是模式判断

正确做法始终是：

- 差异尽量收敛到账户解析层

### 9.3 不要把邮箱模式实现成独立第二套系统

不建议：

- 新建一套 `email_executor`
- 新建一套单独 GUI
- 新建一套单独 daemon

因为这样会导致：

- 维护成本翻倍
- 风控和日志体系分叉
- 后续回归测试更难

---

## 10. 推荐落地顺序

按最现实、最稳妥的顺序，建议直接这样推进：

1. 先改 `types.ts`、`app_config.ts`
2. 再改 `auth.ts`，把模式解析集中收口
3. 再补 `app_ui_state.ts`、`gui_server.ts` 的展示与编辑能力
4. 再补 `runtime_state` 和日志中的 `accountMode`
5. 然后用测试邮箱账户跑 `lifecycle-demo`
6. 最后再碰 `auto_redeem.ts` 的邮箱模式兼容验证

---

## 11. 一句话总结

下一步最正确的改法，不是推翻当前钱包模式系统，而是在当前 `ts_executor` 上新增一层统一的账户模式抽象，让 `eoa` 与 `poly_proxy` 两种模式共享同一套策略、执行、对账、daemon、GUI 和风控骨架；第一阶段先把模式纳入正式配置、会话与日志体系，第二阶段再用测试邮箱账户完成真实小额验证，最后才推进自动回款和长期运行兼容。
