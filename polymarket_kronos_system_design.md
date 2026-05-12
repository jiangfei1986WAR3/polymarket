# Polymarket BTC/ETH 一小时预测市场自动博弈系统开发文档

本文档总结我们围绕“使用 K 线时序预测模型 Kronos 构建 Polymarket 一小时 BTC/ETH 涨跌预测市场自动博弈系统”的完整讨论，并将思路整理成一套可执行的系统设计方案。

本文不是投资建议，也不是保证盈利的策略说明。它的目标是把一个交易/博弈想法拆解成可验证、可回测、可部署、可风控的工程系统。

---

## 1. 项目目标

目标是构建一个 24 小时自动运行的预测市场博弈系统，主要面向 Polymarket 上的 BTC 和 ETH 一小时 Up/Down 市场。

系统最终希望做到：

- 自动获取 BTC/ETH 一小时 K 线与实时价格。
- 自动发现 Polymarket 上对应的 BTC/ETH 一小时涨跌市场。
- 使用 Kronos 等 K 线时序预测模型生成未来路径。
- 使用“已知前 11 根 K 线”反向筛选或加权预测分身。
- 将模型输出的价格预测转换成上涨/下跌概率。
- 将模型概率与 Polymarket 盘口价格比较，计算期望收益 EV。
- 只在正期望明显、风险可控、执行价格合理时下注。
- 支持 paper mode、small live mode、full live mode。
- 使用 AI Agent 参与监控、解释、复盘和异常判断，但不让 AI Agent 无约束地下单。

系统定位不是“预测涨跌机器人”，而是：

```text
概率定价 + 条件路径推断 + 盘口错价识别 + 风控执行 + AI 监督
```

---

## 2. 核心思想总结

传统时序预测做法通常是：

```text
输入最近 512 根一小时 K 线
预测下一根或未来多根 K 线
根据预测涨跌直接交易
```

我们讨论后的改进思路是：

```text
故意让模型少看最近 11 根已经发生的 K 线
让模型从更早的时间点预测未来 12 根 K 线
其中前 11 根已经真实发生
用这 11 根真实 K 线判断哪些预测路径更像当前市场
再使用这些路径对第 12 根 K 线的预测来指导当前决策
```

设当前需要预测的小时为 `T+1`，则：

```text
模型输入：到 T-11 为止的历史 K 线
模型输出：T-10, T-9, ..., T, T+1 共 12 根预测 K 线
已知部分：T-10 到 T 共 11 根真实 K 线
未知部分：T+1
```

系统使用已知的 11 根真实 K 线，对预测分身进行筛选、加权、校准，然后推断第 12 根 K 线方向。

这套逻辑的本质不是“单纯预测未来”，而是：

```text
用已经发生的路径信息，反向识别当前市场处于哪种隐藏状态，
再根据这个隐藏状态下的条件分布，判断下一小时上涨或下跌概率。
```

更专业的理解可以接近：

- 条件路径筛选。
- 粒子过滤。
- 贝叶斯后验重加权。
- Ensemble reweighting。
- Path-conditioned forecasting。

---

## 3. 硬币类比与市场隐藏状态

我们讨论过一个重要类比：

```text
如果硬币连续出现 10 次正面，
理论上第 11 次仍然是 50% 正面、50% 反面。
```

但在现实世界中，如果连续出现 10 次正面，人们不会只认为“这是随机巧合”，也会怀疑：

```text
硬币是否不公平？
投掷方式是否有问题？
环境是否有影响？
样本生成机制是否已经改变？
```

这个类比对市场非常重要。

市场中的 K 线不是独立公平硬币。连续出现某种走势，可能意味着：

- 当前处于趋势状态。
- 当前处于强波动状态。
- 当前有消息冲击。
- 当前流动性结构改变。
- 当前市场参与者行为发生偏移。
- 当前 BTC/ETH 与宏观或其他资产的相关性增强。

因此，已知的前 11 根 K 线不是无用信息。它可能暴露了当前市场的隐藏状态。

我们的模型不是在问：

```text
下一根 K 线是否独立随机？
```

而是在问：

```text
如果过去 11 根 K 线已经呈现出某种路径，
那么在历史和模型生成的相似路径中，
第 12 根更倾向于上涨还是下跌？
```

---

## 4. 为什么不能只看胜率超过 50%

Polymarket 的价格本身可以理解成市场隐含概率。

例如：

```text
BTC Up 当前 ask = 0.56
```

这大致表示：

```text
市场要求你用 0.56 美元购买 1 美元面值的 BTC Up 结果代币。
```

如果赢，最终得到 1 美元；如果输，归零。

因此，买入一个二元合约的期望收益近似为：

```text
EV = 你的真实胜率 q - 成交价格 p - 交易成本 cost
```

所以系统不是只要判断：

```text
上涨概率是否大于 50%
```

而是要判断：

```text
上涨概率 q 是否大于 Polymarket 成交价格 p，加上手续费、点差、滑点和安全边际。
```

举例：

```text
模型校准后认为 BTC 上涨概率 q = 55%
Polymarket BTC Up ask = 60%

EV = 0.55 - 0.60 = -0.05
```

虽然模型认为上涨概率超过 50%，但这是一个负期望下注。

再举例：

```text
模型认为 BTC 上涨概率 q_up = 48%
则下跌概率 q_down = 52%
Polymarket BTC Down ask = 47%

EV_down = 0.52 - 0.47 = +0.05
```

这时买 Down 反而可能是正期望。

核心结论：

```text
预测市场赚钱的关键不是“猜对方向超过 50%”，
而是“你的概率估计长期比市场价格更准确，并且成交价格足够便宜”。
```

---

## 5. Kronos 输出价格，如何变成概率

Kronos 等 K 线时序预测模型通常输出的是未来价格或 K 线：

```text
open / high / low / close / volume
```

或者至少输出：

```text
future close
```

模型本身不一定直接输出：

```text
BTC 下一小时上涨概率 = 56%
```

概率需要由系统加工出来。

### 5.1 单次预测只能给方向

假设当前小时开盘价：

```text
open = 100000
```

Kronos 单次预测下一小时收盘价：

```text
predicted_close = 100200
```

则只能说明：

```text
该次预测认为上涨
```

但它不能说明：

```text
上涨概率是多少
```

### 5.2 多分身投票产生原始概率

如果生成 1000 个预测分身：

```text
分身 1：close = 100120，上涨
分身 2：close = 99880，下跌
分身 3：close = 100300，上涨
...
分身 1000：close = 100050，上涨
```

如果其中：

```text
560 个预测上涨
440 个预测下跌
```

则原始上涨概率为：

```text
raw_q_up = 560 / 1000 = 56%
```

### 5.3 路径加权产生条件概率

因为我们有前 11 根已知 K 线，所以可以计算每个分身预测的前 11 根与真实前 11 根的误差。

预测越像真实路径，权重越高。

计算方式可以是：

```text
weight_i = exp(-error_i / temperature)
```

然后：

```text
weighted_q_up =
    所有预测上涨分身的权重之和 / 所有分身权重之和
```

例如：

```text
普通统计：
560 个上涨，440 个下跌
raw_q_up = 56%

路径加权后：
上涨分身总权重 = 680
下跌分身总权重 = 320
weighted_q_up = 68%
```

这说明虽然普通数量上只有 56% 分身看涨，但更像当前市场路径的分身大多看涨。

### 5.4 历史校准得到真实概率

即使加权后得到：

```text
weighted_q_up = 68%
```

也不能直接相信它是真实概率。

因为模型可能过度自信。

通过历史回测可能发现：

```text
模型说 55% 时，真实上涨 52%
模型说 60% 时，真实上涨 55%
模型说 65% 时，真实上涨 58%
模型说 70% 时，真实上涨 61%
模型说 80% 时，真实上涨 64%
```

因此：

```text
weighted_q_up = 68%
```

经过校准后可能变成：

```text
q_up = 60%
```

最终用于交易的必须是校准后的概率 `q_up`，不是模型原始输出。

---

## 6. 为什么需要加权，而不是只选择前 11 根最准的分身

一个直观想法是：

```text
既然某个分身前 11 根预测最准，
那就直接用这个分身预测第 12 根。
```

这个想法合理，但存在风险。

### 6.1 Top 1 可能只是随机撞中

如果生成 1000 个分身，总会有几个分身刚好与前 11 根真实路径非常接近。

这就像让 1000 个人猜硬币正反面，总有人连续猜对很多次。但这不代表他真的具备预测下一次的能力。

在市场里也是这样：

```text
前 11 根预测最准的分身，
可能只是历史拟合冠军，
不是未来预测冠军。
```

### 6.2 加权可以降低单个分身误导风险

加权的意义是：

```text
不要把全部判断交给一个冠军，
而是让一批与当前市场相似的分身共同投票。
```

例如：

```text
第 1 名：误差 0.010，预测上涨
第 2 名：误差 0.012，预测下跌
第 3 名：误差 0.013，预测上涨
第 4 名：误差 0.014，预测上涨
第 5 名：误差 0.015，预测下跌
```

只看第 1 名会得到：

```text
买涨
```

但看前 100 个分身可能发现：

```text
60% 权重看涨
40% 权重看跌
```

这样得到的是概率分布，而不是一个脆弱的单点判断。

### 6.3 最优方式需要回测决定

系统不应预设“加权一定最好”或“Top 1 一定最好”。

应该同时测试：

```text
方法 A：只用 Top 1
方法 B：Top 5 简单投票
方法 C：Top 20 简单投票
方法 D：Top 100 按误差加权
方法 E：全部分身按误差加权
方法 F：前 5% 分身按误差加权
```

比较指标包括：

- 第 12 根方向准确率。
- Brier score。
- Log loss。
- 校准曲线。
- 盈亏表现。
- 最大回撤。
- 最长连亏。
- 高置信度分层的实际胜率。

推荐初始方案：

```text
先筛掉误差很大的分身，
只保留前 5% 到 10%，
再对保留分身按误差加权。
```

这兼顾了“只相信最像当前市场的分身”和“避免单一冠军随机误导”。

---

## 7. 分身系统设计

分身可以来自多种差异化来源。

### 7.1 不同历史窗口长度

```text
context_length = [128, 256, 384, 512, 768, 1024]
```

短窗口更敏感，长窗口更稳定。

### 7.2 不同采样参数

```text
temperature = [0.4, 0.6, 0.8, 1.0, 1.2]
top_p = [0.80, 0.90, 0.95, 0.98]
random_seed = 多组随机种子
```

低 temperature 更保守，高 temperature 更多样。

### 7.3 不同输入市场

可以测试：

```text
BTC 单独输入
ETH 单独输入
BTC + ETH 联合特征
BTC + ETH + SOL
BTC + ETH + 总市值代理
BTC + ETH + 美股/美元指数/黄金等宏观特征
```

第一版建议只做 BTC/ETH，避免过度复杂。

### 7.4 不同预测目标

```text
预测 close
预测 OHLCV
预测 return
预测 normalized return
预测方向 token
预测路径分布
```

对于 Polymarket 一小时 Up/Down，方向最重要，但振幅和波动也能帮助判断信号质量。

---

## 8. 路径匹配误差设计

不要只比较裸价格，因为价格绝对值会受长期趋势影响。

更推荐比较标准化路径。

### 8.1 基础特征

每根 K 线可以转换成：

```text
return = close / open - 1
body = (close - open) / open
range = (high - low) / open
upper_shadow = (high - max(open, close)) / open
lower_shadow = (min(open, close) - low) / open
volume_change = log(volume / previous_volume)
direction = sign(close - open)
```

### 8.2 路径误差

可以定义：

```text
error_i =
    w_return * MSE(pred_return, true_return)
  + w_body * MSE(pred_body, true_body)
  + w_range * MSE(pred_range, true_range)
  + w_shadow * MSE(pred_shadow, true_shadow)
  + w_volume * MSE(pred_volume_change, true_volume_change)
  + w_direction * direction_mismatch_rate
```

### 8.3 时间衰减

越接近当前的 K 线越重要：

```text
最近 3 根权重大
更早 8 根权重小
```

例如：

```text
time_weight_j = exp(-lambda * distance_from_current)
```

### 8.4 波动率归一化

高波动时期，同样的价格误差可能不严重；低波动时期，同样误差可能很严重。

可以使用：

```text
normalized_error = raw_error / recent_volatility
```

---

## 9. 分身历史信誉系统

我们讨论过一个重要问题：

如果上一小时系统买涨，结果实际下跌，那么下一小时系统重新匹配时，主导信号是否会换成另一批分身？

答案是：

```text
会，而且这是正常现象。
```

每一小时真实 K 线更新后，系统都会重新判断当前市场更像哪一类路径。

但系统不能每小时完全失忆。

必须给每个分身记录历史信誉。

### 9.1 两类评分

每个分身至少有两个评分：

```text
当前路径匹配分：
    最近 11 根预测得像不像？

历史可靠性分：
    过去第 12 根预测到底准不准？
```

最终权重：

```text
final_weight_i =
    current_similarity_i
  * historical_reliability_i
  * recent_stability_i
```

### 9.2 历史可靠性更新

例如：

```text
如果分身预测方向正确：
    reliability_i += reward

如果分身预测方向错误：
    reliability_i -= penalty
```

更稳健的方式是使用指数移动平均：

```text
reliability_i =
    alpha * previous_reliability_i
  + (1 - alpha) * latest_score_i
```

其中 latest_score 可以是：

```text
方向是否正确
第 12 根 return 误差
预测概率对数损失
该分身参与权重下的收益贡献
```

### 9.3 避免连续使用失败分身

如果某类分身前 11 根经常很像，但第 12 根经常错，则系统应降低其信誉。

例如：

```text
分身 A：
当前前 11 根非常像
最近 20 次第 12 根只对了 8 次

分身 B：
当前前 11 根稍微差一点
最近 20 次第 12 根对了 13 次
```

系统不应盲目选择 A。

---

## 10. 校准层设计

校准层负责将模型输出转换成真实概率。

### 10.1 为什么需要校准

模型可能输出：

```text
weighted_q_up = 70%
```

但历史上，当模型说 70% 时，真实上涨可能只有 61%。

这说明模型过度自信。

### 10.2 校准目标

校准层输入：

```text
raw_q_up
weighted_q_up
路径匹配质量
分身分歧程度
预测幅度
当前波动率
距离小时开盘价的距离
剩余时间
盘口价格
```

校准层输出：

```text
calibrated_q_up
calibrated_q_down = 1 - calibrated_q_up
```

### 10.3 可选校准方法

第一阶段可以用简单分箱：

```text
模型输出 50%-55%：历史真实上涨率
模型输出 55%-60%：历史真实上涨率
模型输出 60%-65%：历史真实上涨率
...
```

进阶方法：

- Platt Scaling。
- Isotonic Regression。
- Beta Calibration。
- Logistic Regression 校准器。
- LightGBM 二阶段校准器。

### 10.4 校准评估指标

```text
Brier score
Log loss
Reliability diagram
Expected calibration error
置信度分层准确率
```

例如，如果系统在所有预测 `q = 60%` 的样本中，真实上涨率接近 60%，则说明校准较好。

---

## 11. EV 决策层设计

决策层负责判断是否下注、买哪边、下多大。

### 11.1 基础公式

买 Up：

```text
EV_up = q_up - ask_up - cost
```

买 Down：

```text
q_down = 1 - q_up
EV_down = q_down - ask_down - cost
```

其中：

```text
q_up      = 校准后的上涨概率
ask_up    = 买入 Up 的实际成交价格
ask_down  = 买入 Down 的实际成交价格
cost      = 手续费 + 点差 + 滑点 + 延迟风险 + 安全边际
```

### 11.2 决策规则

```text
如果 EV_up > threshold 且 EV_up > EV_down：
    考虑买 Up

如果 EV_down > threshold 且 EV_down > EV_up：
    考虑买 Down

否则：
    不下注
```

### 11.3 示例

```text
q_up = 0.61
q_down = 0.39

ask_up = 0.56
ask_down = 0.46
cost = 0.01
threshold = 0.02
```

计算：

```text
EV_up = 0.61 - 0.56 - 0.01 = 0.04
EV_down = 0.39 - 0.46 - 0.01 = -0.08
```

结果：

```text
买 Up
```

再例：

```text
q_up = 0.54
ask_up = 0.52
cost = 0.01
threshold = 0.02

EV_up = 0.54 - 0.52 - 0.01 = 0.01
```

虽然 EV 为正，但低于阈值，所以不下注。

### 11.4 分层下注

不建议所有信号使用同一仓位。

可采用：

```text
EV < 1%：
    不下注

EV 1%-2%：
    只允许 maker 挂单，小仓

EV 2%-4%：
    正常小仓

EV 4%-7%：
    高质量机会，中等仓位

EV > 7%：
    罕见机会，但仍受总风控限制
```

---

## 12. 为什么不建议使用传统马丁

马丁策略逻辑是：

```text
亏了就加倍，
直到赢一次把之前亏损赚回来。
```

这种策略在理论上看起来诱人，但在现实中问题很大。

### 12.1 连亏一定会出现

假设真实胜率为 55%，亏损概率为 45%。

BTC + ETH 一小时市场每天约 48 个基础机会。

长期运行下，连续亏损一定会出现。

传统翻倍马丁在 10 连亏时：

```text
第 1 注：1
第 2 注：2
第 3 注：4
第 4 注：8
第 5 注：16
第 6 注：32
第 7 注：64
第 8 注：128
第 9 注：256
第 10 注：512
第 11 注：1024
```

累计风险接近：

```text
2047
```

如果赔率不是 0.50，而是 0.55 或 0.60，恢复亏损需要更大的投入。

### 12.2 BTC 与 ETH 亏损可能相关

BTC 和 ETH 高度相关。

如果系统在某种行情状态下失效，它可能同时在 BTC 和 ETH 上连续亏损。

### 12.3 马丁会放大模型失效

如果模型 edge 不存在，马丁会加速亏损。

如果模型 edge 存在，马丁也不是最优资金管理方式。

推荐使用：

```text
分数 Kelly + 固定风险上限 + 连亏熔断
```

---

## 13. 仓位与风控设计

### 13.1 基础风险限制

建议初始限制：

```text
单笔最大风险：账户权益的 0.5% - 2%
单市场最大风险：账户权益的 2% - 5%
单日最大亏损：账户权益的 3% - 5%
连续亏损阈值：3 - 5 次触发降仓或暂停
单小时最大下注次数：限制为 1 - 3 次
```

### 13.2 分数 Kelly

对于二元合约，可以近似使用：

```text
kelly_fraction ≈ (q - p) / (1 - p)
```

实际不要用满 Kelly。

推荐：

```text
实际下注 = 0.1 Kelly 到 0.25 Kelly
```

### 13.3 连续亏损处理

建议规则：

```text
连续错 2 次：
    仓位减半

连续错 3 次：
    暂停对应币种若干小时

连续错 4 次：
    全系统进入观察模式

连续错 5 次：
    强制停止 live mode，需要人工确认
```

### 13.4 模型置信度异常

暂停条件：

```text
分身分歧过大
路径匹配质量过低
近期校准误差变大
盘口流动性过低
API 延迟过高
结算源价格与交易所价格不同步
市场临近结算且价格跳动剧烈
```

---

## 14. 交易频率问题

我们讨论过一个担忧：

```text
如果 EV 层太严格，会不会连续几天甚至一个月都不下注？
```

答案是：

```text
有可能，但合理系统不应该长期一月只交易一次。
```

BTC + ETH 一小时盘每天约有：

```text
24 + 24 = 48 个基础市场机会
```

但系统不应只在每小时开盘前判断一次。

可以在一小时内多次评估：

```text
开盘后 5 分钟
15 分钟
30 分钟
45 分钟
55 分钟
```

因此监控机会是：

```text
48 个市场 × 每小时多次检测
```

合理交易频率可能是：

```text
普通日：2 - 6 次
高波动日：8 - 15 次
低波动或盘口很准：0 - 2 次
极端异常：自动暂停
```

正确目标不是：

```text
每小时都下注
```

而是：

```text
系统 24 小时寻找便宜价格，
只在正期望足够明确时行动。
```

---

## 15. 小时内动态概率模型

仅在小时开始前预测整根 K 线，可能交易频率低，也可能错过盘中机会。

更实用的方式是加入小时内实时模型。

### 15.1 一小时 Up/Down 的核心问题

市场结算通常取决于：

```text
该小时 close 是否高于该小时 open
```

所以小时内的关键变量是：

```text
当前价格距离 open 的距离
剩余时间
当前波动率
当前趋势速度
盘口价格
```

### 15.2 示例

```text
BTC 当前小时 open = 100000
当前时间：本小时第 45 分钟
当前价格 = 100350
距离 open = +0.35%
剩余时间 = 15 分钟
当前波动率较低
```

此时 BTC Up 的真实概率可能较高。

但如果波动率极高，+0.35% 也可能不安全。

### 15.3 条件概率模型

系统可以估计：

```text
q_up = P(final_close > hour_open | current_price, hour_open, remaining_time, volatility, orderbook)
```

Kronos 负责判断大方向和路径状态，小时内模型负责判断剩余时间的翻盘概率。

---

## 16. Maker 与 Taker 执行策略

### 16.1 Taker 单

Taker 单是直接吃盘口。

优点：

```text
成交确定性高
```

缺点：

```text
成本高
容易被点差和手续费吃掉 edge
```

Taker 单应要求更高 EV：

```text
taker_threshold = 2% - 4%
```

### 16.2 Maker 挂单

Maker 是挂一个你愿意买的价格。

例如：

```text
模型认为 BTC Up 真实概率 q = 56%
当前 ask = 55%，不值得追

但可以挂 bid = 52%
如果成交，EV = 56% - 52% - cost
```

Maker 策略可以提高参与机会，同时避免买贵。

### 16.3 挂单撤单逻辑

挂单必须有撤单条件：

```text
模型概率变化
盘口价格变化
距离结算太近
价格源剧烈波动
订单长时间未成交
EV 变成负值
```

---

## 17. 系统总架构

建议系统不要做成传统 Windows EXE 作为生产形态。

如果部署在阿里云日本东京服务器，推荐：

```text
Linux 后台服务 + Docker Compose + Web 控制台
```

或者：

```text
systemd 服务 + 配置文件 + Web 面板
```

### 17.1 模块划分

```text
1. 数据采集层
   Binance K 线、实时价格、成交量、WebSocket。

2. Polymarket 市场层
   自动发现 BTC/ETH 一小时市场，读取 orderbook、价格、流动性、到期时间。

3. Kronos 推理层
   生成多组路径分身。

4. 路径匹配层
   使用已知前 11 根 K 线计算分身相似度。

5. 分身信誉层
   记录每个分身历史预测表现。

6. 概率校准层
   将 raw_q / weighted_q 转成 calibrated_q。

7. EV 决策层
   比较模型概率和市场价格，只做正期望机会。

8. 执行层
   下单、撤单、成交检查、仓位管理。

9. 风控层
   单笔、单日、连亏、异常行情、API 异常控制。

10. AI Agent 层
    分析、解释、复盘、异常告警、参数建议。

11. Web 控制台
    配置、监控、交易记录、模型状态、手动暂停。

12. 日志与审计层
    保存所有输入、输出、决策和成交记录。
```

---

## 18. AI Agent 的角色

AI Agent 可以加入，但不应该让 AI Agent 无约束地下单。

推荐定位：

```text
AI Agent 是监督员、分析员、复盘员，不是最终交易执行者。
```

### 18.1 AI Agent 适合做的事

```text
1. 解释信号
   为什么本小时模型倾向 BTC Up 或 ETH Down。

2. 判断异常
   API 延迟、盘口异常、成交失败、价格源不一致。

3. 日终复盘
   总结当天每笔交易的 EV、结果、错误原因。

4. 参数建议
   提醒某些分身近期表现恶化，建议降低权重。

5. 风险提醒
   连亏、回撤、模型失效、低流动性。

6. 自动生成报告
   每日/每周策略表现分析。
```

### 18.2 AI Agent 不应该做的事

```text
不应绕过 EV 层直接下单。
不应绕过风控层加仓。
不应在连续亏损后自行提高风险。
不应凭自然语言判断修改核心资金规则。
```

### 18.3 最终决策结构

```text
Kronos / 统计模型：
    负责概率预测

校准层：
    负责把预测转成真实概率

EV 层：
    负责判断是否有正期望

风控层：
    拥有最终否决权

AI Agent：
    负责解释、监控、复盘和建议
```

---

## 19. 数据库设计草案

### 19.1 candles 表

```text
id
symbol
exchange
timeframe
open_time
close_time
open
high
low
close
volume
created_at
```

### 19.2 polymarket_markets 表

```text
id
market_id
condition_id
symbol
event_slug
start_time
end_time
resolution_source
up_token_id
down_token_id
status
created_at
```

### 19.3 orderbook_snapshots 表

```text
id
market_id
timestamp
bid_up
ask_up
bid_down
ask_down
spread_up
spread_down
liquidity_up
liquidity_down
raw_orderbook_json
```

### 19.4 predictions 表

```text
id
timestamp
symbol
target_hour
model_name
context_length
temperature
top_p
seed
predicted_ohlcv_json
match_error
current_similarity
historical_reliability
final_weight
predicted_direction
predicted_return
```

### 19.5 probability_signals 表

```text
id
timestamp
symbol
target_hour
raw_q_up
weighted_q_up
calibrated_q_up
q_down
confidence
dispersion
match_quality
calibration_version
```

### 19.6 decisions 表

```text
id
timestamp
symbol
market_id
target_hour
q_up
q_down
ask_up
ask_down
cost_estimate
ev_up
ev_down
decision
side
stake
reason
risk_flags_json
```

### 19.7 orders 表

```text
id
timestamp
market_id
side
outcome
order_type
limit_price
size
status
filled_size
average_fill_price
external_order_id
created_at
updated_at
```

### 19.8 settlements 表

```text
id
market_id
symbol
target_hour
hour_open
hour_close
actual_outcome
system_side
win_loss
pnl
settled_at
```

### 19.9 strategy_state 表

```text
id
timestamp
symbol
daily_pnl
total_pnl
drawdown
consecutive_losses
mode
is_paused
pause_reason
```

---

## 20. 回测设计

### 20.1 第一阶段：只验证模型路径逻辑

目标：

```text
验证前 11 根路径匹配度是否能提高第 12 根方向预测能力。
```

流程：

```text
对于每个历史时刻 T：
1. 只给模型看到 T-11 之前的数据。
2. 生成未来 12 根 K 线预测。
3. 使用真实 T-10 到 T 的 11 根 K 线计算匹配误差。
4. 使用不同方法得到第 12 根方向概率。
5. 与真实 T+1 方向比较。
```

必须比较：

```text
Top 1
Top 5
Top 20
Top 100
全体加权
前 5% 加权
前 10% 加权
无路径筛选基线
简单技术指标基线
随机 50% 基线
```

### 20.2 第二阶段：概率校准回测

目标：

```text
验证模型输出概率是否可信。
```

分析：

```text
模型说 55% 时，真实是多少？
模型说 60% 时，真实是多少？
模型说 65% 时，真实是多少？
高置信度样本是否真的更准？
```

### 20.3 第三阶段：加入 Polymarket 历史盘口

目标：

```text
验证模型概率相对市场价格是否存在 edge。
```

需要记录或获取：

```text
ask_up
bid_up
ask_down
bid_down
spread
liquidity
成交量
市场到期时间
```

### 20.4 第四阶段：真实纸面交易

目标：

```text
在实时环境中模拟系统是否能正收益。
```

系统只记录：

```text
如果下单，会买什么？
什么价格？
多少仓位？
最终盈亏？
```

不真实下单。

建议至少运行：

```text
30 天
```

更理想：

```text
60 - 90 天
```

---

## 21. 关键评估指标

不要只看胜率。

必须同时看：

```text
方向准确率
Brier score
Log loss
校准曲线
平均 EV
实际收益
扣费后收益
最大回撤
最长连亏
夏普或 Sortino
每日交易次数
每笔平均收益
高 EV 分层收益
不同市场状态下收益
BTC 与 ETH 相关亏损
成交成功率
滑点
撤单率
```

尤其重要的是：

```text
按 EV 分层后的实际表现。
```

例如：

```text
EV 1%-2%：是否真的赚钱？
EV 2%-4%：是否更赚钱？
EV 4%-7%：是否明显更好？
```

如果 EV 越高实际收益越好，说明系统逻辑成立。

如果 EV 高低与收益无关，说明概率或成本估计有问题。

---

## 22. 开发阶段路线

### V1：离线研究与回测

功能：

```text
Binance 历史 K 线下载
Kronos 批量推理
分身生成
路径匹配
Top K / 加权方法比较
校准曲线
基础报告
```

目标：

```text
证明或证伪“前 11 根路径匹配度能提高第 12 根预测能力”。
```

### V2：实时纸面交易系统

功能：

```text
实时获取 BTC/ETH K 线和价格
实时获取 Polymarket 市场和盘口
实时计算 q、EV、决策
记录模拟下单
结算后复盘
Web 控制台
```

目标：

```text
证明系统在真实盘口、真实延迟、真实成本估计下是否有正期望。
```

### V3：小资金实盘

功能：

```text
Polymarket API 下单
限价单
撤单
成交检查
风控熔断
小资金仓位管理
```

目标：

```text
验证真实执行质量、成交率、滑点、手续费和结算流程。
```

### V4：AI Agent 自动运营

功能：

```text
AI 复盘
异常检测
参数建议
自动报告
远程通知
人工确认模式
```

目标：

```text
让系统具备长期运行维护能力。
```

### V5：多市场扩展

可扩展到：

```text
更多币种
更长时间周期
非加密预测市场
套利型市场
相关市场组合
```

---

## 23. 部署形态

推荐部署：

```text
阿里云日本东京服务器
Ubuntu Linux
Docker Compose
PostgreSQL
Redis
FastAPI 后端
Web 控制台
后台 worker
systemd 或 Docker restart policy 自动重启
```

不推荐生产环境只做一个 Windows EXE。

原因：

```text
Linux 服务器更稳定
Docker 方便部署和升级
日志和监控更成熟
系统崩溃后更容易自动恢复
远程维护更方便
```

但可以额外提供：

```text
Windows 桌面配置工具
本地回测 GUI
一键打包版本
```

生产核心仍建议是服务化系统。

---

## 24. 配置文件示例

```yaml
app:
  mode: paper
  symbols:
    - BTC
    - ETH
  timezone: UTC

data:
  exchange: binance
  timeframe: 1h
  warmup_candles: 2000

kronos:
  enabled: true
  context_lengths: [128, 256, 384, 512]
  horizon: 12
  known_path_length: 11
  temperatures: [0.6, 0.8, 1.0]
  top_p: [0.9, 0.95]
  seeds_per_config: 10

matching:
  top_percent: 0.1
  weighting: exp
  temperature: 0.05
  use_historical_reliability: true

calibration:
  method: isotonic
  min_samples_per_bin: 200
  retrain_interval_hours: 24

decision:
  min_ev_taker: 0.03
  min_ev_maker: 0.015
  safety_margin: 0.01
  max_minutes_before_close_for_new_order: 5

risk:
  max_risk_per_trade: 0.01
  max_daily_loss: 0.05
  max_consecutive_losses: 4
  reduce_size_after_losses: 2
  pause_after_losses: 4

execution:
  prefer_maker: true
  order_timeout_seconds: 60
  max_slippage: 0.01

agent:
  enabled: true
  can_trade: false
  daily_report: true
  anomaly_alerts: true
```

---

## 25. 核心伪代码

```python
def run_cycle(symbol, target_hour):
    candles = data_store.get_candles(symbol)
    market = polymarket.find_hourly_market(symbol, target_hour)
    orderbook = polymarket.get_orderbook(market)

    predictions = []

    for config in kronos_configs:
        paths = kronos.generate_paths(
            candles=candles.up_to(target_hour - 11),
            horizon=12,
            config=config,
        )

        for path in paths:
            known_pred = path[0:11]
            unknown_pred = path[11]
            known_true = candles.from_hour(target_hour - 10).to_hour(target_hour)

            error = matching.compute_error(known_pred, known_true)
            reliability = reliability_store.get(config.id)
            weight = matching.compute_weight(error, reliability)

            predictions.append({
                "config": config,
                "path": path,
                "error": error,
                "weight": weight,
                "predicted_close": unknown_pred.close,
                "predicted_direction": unknown_pred.close > target_hour.open,
            })

    raw_q_up = count_up(predictions) / len(predictions)
    weighted_q_up = weighted_count_up(predictions)

    calibrated_q_up = calibrator.transform(
        raw_q_up=raw_q_up,
        weighted_q_up=weighted_q_up,
        match_quality=compute_match_quality(predictions),
        dispersion=compute_dispersion(predictions),
        market_features=extract_market_features(orderbook),
    )

    q_up = calibrated_q_up
    q_down = 1 - q_up

    cost = cost_model.estimate(orderbook, market)

    ev_up = q_up - orderbook.ask_up - cost
    ev_down = q_down - orderbook.ask_down - cost

    decision = decision_engine.decide(
        ev_up=ev_up,
        ev_down=ev_down,
        q_up=q_up,
        q_down=q_down,
        orderbook=orderbook,
        risk_state=risk_manager.state,
    )

    if decision.action == "TRADE":
        if risk_manager.approve(decision):
            execution.place_order(decision)

    audit_log.save(
        symbol=symbol,
        target_hour=target_hour,
        predictions=predictions,
        q_up=q_up,
        ev_up=ev_up,
        ev_down=ev_down,
        decision=decision,
    )
```

---

## 26. 主要风险

### 26.1 模型过拟合

分身越多，越容易在历史中找到看似有效的组合。

必须使用：

```text
walk-forward validation
out-of-sample test
paper trading
冻结参数后验证
```

### 26.2 回测偏差

风险包括：

```text
未来函数
未正确模拟成交
忽略手续费
忽略点差
忽略滑点
忽略未成交
错误使用未收盘 K 线
```

### 26.3 市场效率

Polymarket 热门 BTC/ETH 一小时盘可能已经有大量 bot 和做市商参与。

明显错误价格不会一直存在。

### 26.4 Edge 衰减

即使某段时间有效，策略也可能失效。

必须持续监控：

```text
校准误差
EV 分层收益
模型胜率
收益回撤
市场结构变化
```

### 26.5 法律与合规

必须遵守所在地和平台规则。

系统不应设计为绕过平台限制或地理限制。

---

## 27. 是否可能持续盈利

我们讨论后的判断：

```text
仅靠 Kronos 直接预测方向 + 马丁：
    长期持续盈利概率偏低。

Kronos 分身路径筛选 + 概率校准 + EV 过滤：
    有研究价值，值得做 paper trading 验证。

Kronos + 实时盘口 + 波动率模型 + maker 执行 + 严格风控：
    最有机会接近可持续盈利，但仍不能保证。
```

持续盈利的来源不应是：

```text
模型方向胜率刚好超过 50%
```

而应是：

```text
真实概率估计比市场更准
成交价格比真实概率便宜
执行成本被控制
模型失效时及时停止
只交易高质量机会
```

---

## 28. 最推荐的最终方案

最终系统应是：

```text
Kronos 路径分身：
    判断当前市场状态和未来路径分布。

路径匹配与分身信誉：
    判断哪些分身当前更可信，哪些分身历史上更可靠。

概率校准：
    把模型输出修正成真实概率 q。

小时内动态模型：
    根据当前价格、open、剩余时间、波动率判断翻盘概率。

Polymarket 盘口模型：
    判断市场价格是否便宜，估计成交成本。

EV 决策层：
    只在 q - price - cost 足够大时行动。

执行层：
    优先 maker，必要时 taker，但 taker 要求更高 EV。

风控层：
    拥有最终否决权。

AI Agent：
    监控、解释、复盘、异常告警和参数建议。
```

---

## 29. 下一步建议

推荐立刻进入 V1 阶段，不要直接实盘。

V1 的最小可执行目标：

```text
1. 下载 BTC/ETH 历史 1H K 线。
2. 使用 Kronos 生成多分身 12 步预测。
3. 用前 11 根真实 K 线计算匹配误差。
4. 比较 Top 1、Top K、加权方法对第 12 根方向的预测能力。
5. 生成校准曲线和分层胜率报告。
6. 判断这套理论是否真的产生增益。
```

如果 V1 证明：

```text
前 11 根匹配度越高，第 12 根预测越准；
高置信度分层确实有更高胜率；
校准后概率稳定；
```

则进入 V2：

```text
接入 Polymarket 实时盘口，但只做纸面交易。
```

如果 V2 经过至少 30 天真实纸面交易，扣除估算费用、滑点、未成交后仍然有正收益，再考虑 V3 小资金实盘。

---

## 30. 一句话总结

这套系统真正值得研究的地方不是“用 AI 猜 BTC 下一小时涨跌”，而是：

```text
用已知路径识别当前市场状态，
用多分身推断下一小时条件概率，
用历史校准修正模型自信，
用预测市场价格寻找错价，
用严格风控保证系统活得足够久。
```

如果最终能够盈利，盈利来源也不会是马丁，而是：

```text
概率估计优势 + 盘口定价偏差 + 执行成本控制 + 风控纪律。
```
