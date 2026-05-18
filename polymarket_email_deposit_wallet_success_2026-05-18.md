# Polymarket 邮箱账户 Deposit Wallet 成功验证记录

日期：2026-05-18

## 1. 结论

本次已完成对 `ts_executor` 中 Polymarket 邮箱账户 `deposit_wallet_1271` 模式的真实验证，结果为：

- 只读验证成功
- 余额与 allowance 读取成功
- 测试单预览成功
- 真实小额测试单提交成功
- 订单已真实撮合成交
- Polymarket 后台人工复核无误

这意味着当前系统的邮箱账户真实交易链路已经从早期失败的 `poly_proxy` 路径，切换并打通到了官方要求的 `deposit wallet flow`

---

## 2. 本次成功路径

本次成功配置关系如下：

- `accountMode = deposit_wallet_1271`
- `walletAddress = signer 地址`
- `funderAddress = 留空，由系统自动推导`
- `signatureType = 3`
- `relayer API creds = 已配置`

运行时实际解析结果如下：

- `walletAddress = signer`
- `funderAddress = derived deposit wallet`
- `usedConfiguredFunder = false`

即：

- GUI 中仍然填写邮箱账户导出的私钥
- 系统使用该私钥对应的 `signer` 作为签名身份
- 系统自动推导 `deposit wallet` 作为真实 maker / funder 地址

---

## 3. 关键验证结果

### 3.1 只读验证

只读验证成功时，已经确认：

- `accountMode = deposit_wallet_1271`
- `signatureType = 3`
- `apiCredsPresent = true`
- `collateralBalance = 5000000`，即 `5.0 USDC`
- allowance 为大额值，说明授权已就绪
- `funderAddress` 已自动解析为真实 `deposit wallet`

### 3.2 订单预览

测试单预览成功时，已经确认：

- 系统能成功定位当前可交易市场
- 系统能根据测试金额计算出可提交订单意图
- `BUY / tokenId / price / size / amount / orderType` 均能正确生成

### 3.3 真实下单

真实测试单结果确认：

- `liveOrderSubmitted = true`
- `postResult.success = true`
- `status = matched`
- 已返回真实 `orderID`
- 已返回真实链上 `transaction_hash`
- Polymarket 后台人工检查确认订单真实存在并成交

因此可以正式认定：

**当前邮箱账户 Deposit Wallet 核心下单链路已打通。**

---

## 4. 与旧失败路径的区别

此前 `poly_proxy` 实测曾被 Polymarket 明确拒绝：

```text
maker address not allowed, please use the deposit wallet flow
```

本次成功说明：

- 对当前这类新邮箱账户，`poly_proxy` 不是最终正确的正式下单模式
- `deposit_wallet_1271` 才是当前应保留并继续扩展的邮箱账户模式

---

## 5. 当前建议的 GUI 使用方式

在 GUI 中使用邮箱账户时，当前建议固定采用以下填写方式：

- 账户模式：`Polymarket 邮箱账户模式（Deposit Wallet）`
- 私钥：Polymarket 官网导出的邮箱账户 `signer` 私钥
- `walletAddress`：该私钥对应的 `signer` 地址
- `funderAddress`：默认留空
- `signatureType`：`3`

说明：

- 若 `funderAddress` 留空，系统会自动推导 `deposit wallet`
- 不建议手工乱填 `funderAddress`
- 除非已明确确认某个地址就是该账户的真实 `deposit wallet`

---

## 6. 本次代码固化

为固化本次成功链路，当前代码已继续补充两项小修复：

### 6.1 订单时间显示修复

`client.getOrder()` 返回的 `created_at` 看起来是秒级时间戳，之前被直接按毫秒解析，导致出现 `1970` 年时间。

现已修复为：

- 秒级时间戳自动乘以 `1000`
- 毫秒级时间戳保持原样

### 6.2 成交后持仓快照短暂重试

真实测试单成交后，持仓接口可能存在短暂延迟，导致第一次回查仍显示空仓位。

现已在 GUI 测试单提交链路中补充：

- 成交后短暂等待
- 再次回查 positions
- 减少“明明成交了但回查仍为空”的误判

---

## 7. 后续推荐下一步

现在最合理的下一阶段工作不是再证明“能不能下单”，而是把这条已成功的链路工程化稳定下来：

- 把 `deposit_wallet_1271` 明确固化为邮箱账户正式模式
- 增加一份 GUI 配置模板
- 再换一个离结算更远的市场做第二次复测
- 优化成交后持仓与订单回查展示
- 为正式 daemon 接入增加邮箱账户模式运行检查

---

## 8. 当前阶段判断

截至 2026-05-18，本项目的账户模式现状可以总结为：

- `eoa`：老模式，保留
- `poly_proxy`：已验证不适合作为当前新邮箱账户正式下单路径
- `deposit_wallet_1271`：已完成真实成功验证，应作为邮箱账户主线继续推进
