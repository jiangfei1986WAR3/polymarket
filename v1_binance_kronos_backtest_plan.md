# V1 Binance-only Kronos 路径筛选回测系统开发方案

本文档设计的是第一阶段回测系统，也就是：

```text
只使用 Binance BTC/ETH 1H K 线，
验证 Kronos + 前 11 根路径筛选/加权，
是否能提高第 12 根 K 线方向预测能力。
```

这一阶段不接入 Polymarket，不下单，不计算真实盘口 EV。

它只回答一个最核心的问题：

```text
模型本身有没有方向预测价值？
路径筛选/加权这套思想是否真的有效？
```

如果 V1 不能证明模型有稳定预测增益，那么后续接入 Polymarket、自动下单、AI Agent、风控系统都不应继续贸然实盘。

---

## 1. V1 的目标

V1 的目标不是赚钱，也不是模拟完整交易系统，而是验证一个基础假设。

核心假设：

```text
如果 Kronos 从较早时间点预测未来 12 根 K 线，
并且其中前 11 根预测路径与真实路径高度相似，
那么该预测路径对第 12 根方向应该更有参考价值。
```

换句话说，V1 要验证：

```text
前 11 根越像真实市场，
第 12 根的方向预测是否越准？
```

如果答案是肯定的，说明“路径条件化分身筛选”有价值。

如果答案是否定的，说明该思路至少在当前模型、当前周期、当前资产上暂时不成立。

---

## 2. V1 不做什么

V1 暂时不做：

```text
1. 不接入 Polymarket API。
2. 不获取 Polymarket 盘口。
3. 不计算真实交易手续费。
4. 不模拟真实订单成交。
5. 不做 maker/taker 执行。
6. 不做马丁。
7. 不做真实资金管理。
8. 不让 AI Agent 自动下单。
```

V1 只做：

```text
Binance K 线数据 -> Kronos 多路径预测 -> 前 11 根路径匹配 -> 第 12 根方向评估
```

---

## 3. 核心时间索引定义

这是整个回测最重要的部分，必须严格防止未来函数。

假设我们要预测目标小时 `i`。

对于 Binance 1H K 线：

```text
candle[i].open_time  = 目标小时开始时间
candle[i].open       = 目标小时开盘价
candle[i].close      = 目标小时收盘价
```

在 Polymarket 小时涨跌盘中，通常比较的是：

```text
目标小时 close 是否高于目标小时 open
```

因此，V1 推荐模拟的决策时点是：

```text
目标小时刚开盘之后
```

此时：

```text
candle[i].open 已知
candle[i].close 未知
```

所以，目标方向标签为：

```text
actual_up = candle[i].close > candle[i].open
```

如果 `close == open`，可以按配置处理：

```text
方式 A：作为 down
方式 B：作为 tie，剔除该样本
方式 C：根据目标市场规则处理
```

V1 默认建议：

```text
close == open 时剔除样本
```

因为这类样本极少，且方向含义不强。

---

## 4. 前 11 根和第 12 根如何定义

对于目标小时 `i`：

```text
已知的 11 根 K 线：
    candle[i-11], candle[i-10], ..., candle[i-1]

目标第 12 根 K 线：
    candle[i]

Kronos 输入截止：
    candle[i-12] 以及更早的历史

Kronos 预测 horizon：
    12 根

Kronos 应预测：
    candle[i-11], candle[i-10], ..., candle[i-1], candle[i]
```

也就是说：

```text
模型输入不包含最近 11 根已知 K 线。
模型要从 i-12 往后预测 12 根。
前 11 根预测值用于匹配真实已知路径。
第 12 根预测值用于判断目标小时方向。
```

示意：

```text
历史输入区间：
    ... candle[i-512] ... candle[i-12]

已知但不给模型看的路径：
    candle[i-11] ... candle[i-1]

目标预测：
    candle[i]
```

这正是我们讨论的核心方法。

---

## 5. 目标方向如何从预测 K 线得到

Kronos 可能预测目标小时的 OHLCV：

```text
pred_open
pred_high
pred_low
pred_close
pred_volume
```

对于 Polymarket 一小时涨跌场景，我们更关心：

```text
目标小时 close 是否高于目标小时 open
```

在 V1 中建议做两种评估模式。

### 5.1 Post-open 模式，推荐

假设我们在目标小时刚开盘后判断。

此时真实 `candle[i].open` 已知，`candle[i].close` 未知。

预测方向：

```text
pred_up = pred_close > candle[i].open
```

真实方向：

```text
actual_up = candle[i].close > candle[i].open
```

这是更接近 Polymarket 实战的模式。

### 5.2 Pre-open 模式，辅助

假设我们在目标小时开盘前判断。

此时目标小时真实 open 还未知。

预测方向：

```text
pred_up = pred_close > pred_open
```

真实方向：

```text
actual_up = candle[i].close > candle[i].open
```

这个模式更严格，但不一定对应实际下单时点。

V1 主报告使用 Post-open 模式，辅助报告保留 Pre-open 模式。

---

## 6. 数据需求

V1 只需要 Binance 1H K 线。

### 6.1 交易对

第一版建议：

```text
BTCUSDT
ETHUSDT
```

后续可扩展：

```text
SOLUSDT
BNBUSDT
XRPUSDT
```

但 V1 不建议一开始扩展太多资产，避免变量太多。

### 6.2 K 线字段

每根 K 线至少需要：

```text
symbol
interval
open_time
close_time
open
high
low
close
volume
quote_volume
number_of_trades
taker_buy_base_volume
taker_buy_quote_volume
```

V1 核心只需要：

```text
open_time
open
high
low
close
volume
```

### 6.3 时间范围

建议分三档：

```text
smoke：
    最近 7 到 14 天
    用于确认代码流程正确。

research：
    最近 3 到 6 个月
    用于初步验证路径筛选假设。

formal：
    最近 12 到 24 个月
    用于正式统计评估。
```

如果算力不足，先做：

```text
BTCUSDT 最近 3 个月
每小时 20 到 50 条预测路径
```

跑通后再扩大。

---

## 7. 数据质量检查

下载 Binance K 线后，必须先做数据质量检查。

检查项：

```text
1. open_time 是否严格按 1 小时递增。
2. 是否存在重复 K 线。
3. 是否存在缺失 K 线。
4. OHLC 是否有效。
5. high 是否 >= max(open, close)。
6. low 是否 <= min(open, close)。
7. volume 是否 >= 0。
8. 最新一根未收盘 K 线是否被排除。
```

如果发现缺失 K 线：

```text
少量缺失：
    标记并跳过相关样本。

大量缺失：
    重新下载数据。
```

V1 不建议对缺失 K 线做复杂插值，因为这会污染回测。

---

## 8. 项目目录结构建议

建议创建如下结构：

```text
kronos_v1_backtest/
  README.md
  pyproject.toml
  configs/
    smoke.yaml
    research.yaml
    formal.yaml
  data/
    raw/
      binance/
    processed/
    cache/
      kronos_predictions/
  reports/
  notebooks/
  src/
    data/
      binance_downloader.py
      candle_store.py
      quality_check.py
    features/
      kline_features.py
      normalization.py
    kronos/
      wrapper.py
      prediction_cache.py
    backtest/
      sample_builder.py
      runner.py
      baselines.py
    matching/
      path_error.py
      weighting.py
    evaluation/
      metrics.py
      calibration.py
      report.py
    utils/
      time.py
      logging.py
  tests/
    test_sample_builder.py
    test_no_future_leak.py
    test_path_error.py
    test_weighting.py
```

V1 可以先只实现核心脚本，不必一次做完整 Web 界面。

---

## 9. 配置文件设计

示例 `configs/research.yaml`：

```yaml
run:
  name: btc_eth_1h_v1_research
  mode: research
  random_seed: 42

data:
  exchange: binance
  symbols:
    - BTCUSDT
    - ETHUSDT
  interval: 1h
  start_time: "2025-01-01T00:00:00Z"
  end_time: "2026-05-01T00:00:00Z"
  exclude_unclosed_candle: true

sample:
  known_path_length: 11
  horizon: 12
  min_context_length: 512
  target_mode: post_open
  tie_policy: drop
  sample_stride_hours: 1

kronos:
  enabled: true
  context_lengths: [128, 256, 384, 512]
  temperatures: [0.6, 0.8, 1.0]
  top_p_values: [0.9, 0.95]
  seeds_per_config: 5
  return_all_paths: true
  use_cache: true

matching:
  features:
    return: 1.0
    body: 1.0
    range: 0.5
    upper_shadow: 0.25
    lower_shadow: 0.25
    volume_change: 0.1
    direction: 0.5
  recent_candle_weight: 1.5
  volatility_normalized: true

ensemble:
  methods:
    - raw_all_vote
    - top1
    - top5_vote
    - top20_vote
    - top50_vote
    - top10_percent_weighted
    - all_softmax_weighted
  softmax_temperatures: [0.02, 0.05, 0.1]

evaluation:
  confidence_bins: [0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 1.00]
  bootstrap_iterations: 1000
  output_dir: reports/
```

---

## 10. 样本构建逻辑

对于每个 symbol 和每个目标索引 `i`，构建一个样本。

要求：

```text
i >= max_context_length + known_path_length + 1
```

对于每个样本：

```text
target_candle = candle[i]
known_path = candle[i-11 : i]
input_end = i - 12
model_input = candles ending at input_end
```

Python 风格伪代码：

```python
def build_sample(candles, i, context_length, known_path_length=11):
    input_end_idx = i - known_path_length - 1
    input_start_idx = input_end_idx - context_length + 1

    model_input = candles[input_start_idx : input_end_idx + 1]
    known_true = candles[i - known_path_length : i]
    target_true = candles[i]

    return Sample(
        input=model_input,
        known_true=known_true,
        target_true=target_true,
        target_open=target_true.open,
        target_direction=target_true.close > target_true.open,
    )
```

必须写单元测试确认：

```text
model_input 最后一根是 candle[i-12]
known_true 是 candle[i-11] 到 candle[i-1]
target_true 是 candle[i]
model_input 不包含 candle[i-11] 之后的数据
```

---

## 11. Kronos 推理设计

Kronos 推理层要支持多组配置和多条路径。

### 11.1 分身来源

分身可以来自：

```text
不同 context_length
不同 temperature
不同 top_p
不同 random seed
同一配置下多次采样
```

一个分身应记录：

```text
symbol
target_time
context_length
temperature
top_p
seed
sample_id
predicted_path_12
```

### 11.2 重要要求：返回每条路径

如果 Kronos 的某个接口会把多条 sample 平均成一条结果，V1 不应只使用平均结果。

我们需要：

```text
每一条独立预测路径
```

原因：

```text
概率来自多条路径的方向占比和加权占比。
如果只拿平均路径，就失去了概率分布信息。
```

可选实现：

```text
方式 A：
    sample_count = 1，多次调用，记录不同 seed。

方式 B：
    修改或包装 Kronos predictor，让它返回所有 sample path。
```

推荐：

```text
优先方式 B。
如果短期难做，先用方式 A 跑通。
```

### 11.3 推理缓存

Kronos 推理耗时较高，必须做缓存。

缓存 key：

```text
symbol
target_open_time
context_length
temperature
top_p
seed
horizon
kronos_model_version
input_data_hash
```

缓存内容：

```text
predicted_path_12
inference_time
created_at
config_snapshot
```

如果某次回测中断，可以从缓存继续。

---

## 12. 为什么随机推理不影响回测意义

Kronos 对同一组输入多次推理，结果可能不同。

这不是回测失效的理由。

V1 要验证的不是：

```text
单次推理是否稳定
```

而是：

```text
一个带随机采样的路径分布生成系统，
长期重复运行后是否能形成有效概率。
```

因此，随机性应该被纳入系统：

```text
多次采样 -> 多条路径 -> 方向分布 -> 路径匹配加权 -> 概率估计
```

如果同一输入下分歧很大，反而说明：

```text
模型不确定性较高
应该降低下注信心
```

V1 中应记录：

```text
分身方向分歧程度
预测 close 分布方差
路径匹配误差分布
```

---

## 13. 路径特征设计

不要直接比较裸价格。

因为 BTC 从 30000 到 100000 的价格水平变化会影响误差尺度。

建议将每根 K 线转换成相对特征：

```text
body_return = close / open - 1
high_return = high / open - 1
low_return = low / open - 1
range_return = high / low - 1
upper_shadow = high / max(open, close) - 1
lower_shadow = min(open, close) / low - 1
direction = 1 if close > open else 0
volume_change = log(volume / previous_volume)
```

也可以使用 log return：

```text
log_close_return = log(close / open)
log_high_return = log(high / open)
log_low_return = log(low / open)
```

V1 推荐先使用：

```text
body_return
range_return
upper_shadow
lower_shadow
direction
volume_change
```

---

## 14. 路径误差函数

对于每个预测分身，计算其前 11 根预测路径与真实路径的误差。

误差形式：

```text
error =
    w_body * MSE(pred_body, true_body)
  + w_range * MSE(pred_range, true_range)
  + w_upper * MSE(pred_upper_shadow, true_upper_shadow)
  + w_lower * MSE(pred_lower_shadow, true_lower_shadow)
  + w_volume * MSE(pred_volume_change, true_volume_change)
  + w_direction * direction_mismatch_rate
```

默认权重：

```text
body: 1.0
range: 0.5
upper_shadow: 0.25
lower_shadow: 0.25
volume_change: 0.1
direction: 0.5
```

这些权重只是初始值，需要在 research 阶段比较。

### 14.1 时间权重

越接近目标小时的真实 K 线越重要。

例如 11 根已知路径中：

```text
candle[i-1] 最重要
candle[i-11] 相对较弱
```

可使用：

```text
time_weight[j] = exp(-lambda * distance_to_current)
```

或者简单线性权重：

```text
越近的 K 线权重越高
```

### 14.2 波动率归一化

高波动时期，同样的价格误差不一定严重。

低波动时期，同样的误差可能很严重。

建议使用最近 24 根或 48 根 K 线的 realized volatility 归一化：

```text
normalized_error = raw_error / recent_volatility
```

第一版可以先做不归一化，再加入归一化版本比较。

---

## 15. 分身聚合方法

V1 必须同时比较多种聚合方式。

### 15.1 Raw All Vote

所有分身等权投票。

```text
raw_q_up = 预测上涨分身数量 / 总分身数量
```

这是“无路径筛选”的 Kronos 分布基线。

### 15.2 Top 1

选择前 11 根误差最低的一个分身。

```text
pred_direction = top1.pred_direction
q_up = 1 或 0
```

这个方法最符合直觉，但容易被随机幸运分身误导。

### 15.3 Top K Vote

选择误差最低的前 K 个分身投票。

```text
K = 5, 20, 50, 100
```

计算：

```text
q_up = TopK 中预测上涨分身数量 / K
```

### 15.4 Top Percent Weighted

选择误差最低的前若干比例分身：

```text
top_percent = 5%, 10%, 20%
```

然后按误差加权。

### 15.5 Softmax Weighted

所有分身按误差计算权重：

```text
weight_i = exp(-error_i / tau)
```

计算：

```text
q_up = sum(weight_i for pred_up_i) / sum(weight_i)
```

其中 `tau` 是温度参数：

```text
tau 小：
    更接近 Top 1。

tau 大：
    更接近全体平均。
```

需要测试：

```text
tau = 0.02, 0.05, 0.1, 0.2
```

具体数值要根据误差尺度调整。

---

## 16. 基线方法

V1 必须有基线，否则无法判断路径筛选是否真的有增益。

### 16.1 随机基线

```text
q_up = 0.5
```

方向准确率理论接近 50%。

### 16.2 上一根延续基线

```text
如果 candle[i-1] 上涨，则预测 candle[i] 上涨。
```

### 16.3 最近 3 根多数基线

```text
最近 3 根上涨数量 >= 2，则预测上涨。
```

### 16.4 简单动量基线

```text
最近 N 根 close return 总和 > 0，则预测上涨。
```

N 可取：

```text
3, 6, 12, 24
```

### 16.5 Kronos 无筛选基线

```text
所有 Kronos 分身等权投票。
```

这是最重要的模型基线。

路径筛选方法必须明显优于该基线，才说明前 11 根匹配有价值。

---

## 17. 核心评估指标

V1 不看收益，先看预测统计指标。

### 17.1 方向准确率

```text
accuracy = 预测方向正确数量 / 总样本数量
```

但不能只看 overall accuracy。

### 17.2 Brier Score

衡量概率预测质量。

```text
brier = mean((q_up - actual_up)^2)
```

越低越好。

### 17.3 Log Loss

衡量概率预测是否过度自信。

```text
log_loss = -mean(y * log(q) + (1-y) * log(1-q))
```

越低越好。

### 17.4 校准曲线

按预测概率分箱：

```text
50%-55%
55%-60%
60%-65%
65%-70%
70%-80%
80%-100%
```

观察：

```text
模型说 60% 的时候，真实上涨率是否接近 60%？
```

### 17.5 高置信度分层准确率

计算：

```text
confidence = abs(q_up - 0.5)
```

例如：

```text
confidence >= 5%
confidence >= 10%
confidence >= 15%
```

分别统计：

```text
样本数
方向准确率
Brier score
```

如果高置信度样本没有更高准确率，说明模型概率不可用。

### 17.6 路径误差分位分析

这是 V1 最核心的分析。

把所有分身或样本按前 11 根匹配误差分成 10 组：

```text
误差最低 10%
误差 10%-20%
...
误差最高 10%
```

观察每组第 12 根预测准确率。

理想结果：

```text
误差最低组的第12根准确率明显高于误差最高组。
误差越低，预测越准，呈现一定单调关系。
```

如果没有这个关系，说明路径筛选不成立。

### 17.7 Lift

相对基线提升：

```text
lift = method_accuracy - baseline_accuracy
```

重点比较：

```text
路径筛选方法 vs Kronos 全体等权投票
路径筛选方法 vs 最近动量基线
路径筛选方法 vs 随机 50%
```

---

## 18. 统计显著性

由于方向预测的优势可能很小，必须做置信区间。

### 18.1 Binomial Confidence Interval

对于准确率，计算置信区间。

例如：

```text
accuracy = 53.2%
95% CI = [51.8%, 54.6%]
```

如果置信区间包含 50%，就不能说有稳定优势。

### 18.2 Bootstrap

对样本按时间块 bootstrap。

不要完全随机打散每小时样本，因为时间序列有相关性。

建议 block bootstrap：

```text
block_size = 24 小时 或 72 小时
```

输出：

```text
accuracy CI
Brier CI
lift CI
```

### 18.3 多重比较风险

如果测试很多参数：

```text
context_length
temperature
top_p
topK
tau
特征权重
```

总会有某个组合在历史上表现很好。

必须使用：

```text
训练期调参
验证期选择
测试期只评估一次
```

---

## 19. 时间切分方案

不能随机切分时间序列。

建议使用 chronological split：

```text
训练/探索期：
    前 60%
    用于调试、选择特征、选择 TopK/tau。

验证期：
    中间 20%
    用于确定最终参数。

测试期：
    最后 20%
    只跑一次正式评估。
```

如果使用 12 个月数据：

```text
前 7.2 个月：探索
中间 2.4 个月：验证
最后 2.4 个月：测试
```

更严谨方式：

```text
walk-forward validation
```

例如：

```text
用前 3 个月选择参数
评估第 4 个月

用前 4 个月选择参数
评估第 5 个月

持续滚动
```

V1 第一版可以先做固定时间切分，后续再做 walk-forward。

---

## 20. 样本量建议

BTC + ETH 一小时 K 线样本数量大约：

```text
每天：48 个目标样本
30 天：约 1440 个样本
90 天：约 4320 个样本
365 天：约 17520 个样本
```

### 20.1 初步验证

```text
至少 3 个月
BTC + ETH 合计约 4320 个样本
```

可以初步观察：

```text
路径误差分位是否有单调关系
高置信度样本是否更准
```

### 20.2 正式验证

```text
建议 6 到 12 个月
```

因为如果真实 edge 只有：

```text
52% 到 54%
```

样本太少很容易被随机波动掩盖。

### 20.3 分身数量

初始：

```text
每个目标样本 20 到 50 条预测路径
```

研究：

```text
每个目标样本 50 到 100 条预测路径
```

正式：

```text
每个目标样本 100 到 300 条预测路径
```

如果算力充足：

```text
500 到 1000 条路径
```

但不建议一开始就这么重。

---

## 21. 计算量估算

总推理次数近似为：

```text
样本数量 × 每个样本分身数量
```

例如：

```text
90 天 BTC + ETH：
    约 4320 个样本

每个样本 100 条路径：
    432000 条路径
```

如果单条路径推理耗时 0.5 秒：

```text
432000 × 0.5 秒 = 216000 秒 = 60 小时
```

所以必须：

```text
1. 使用缓存。
2. 先跑小样本。
3. 尽量批量推理。
4. 如果可能使用 GPU。
5. 支持断点续跑。
```

V1 开发顺序：

```text
先用 7 天数据和少量路径验证流程。
再用 30 天数据调试报告。
最后扩大到 3 到 12 个月。
```

---

## 22. 输出文件设计

每次回测生成一个 run_id。

目录：

```text
reports/
  run_2026xxxx_xxxxxx/
    config.yaml
    summary.md
    metrics_overall.csv
    metrics_by_symbol.csv
    metrics_by_method.csv
    confidence_bins.csv
    calibration_bins.csv
    error_deciles.csv
    predictions.parquet
    sample_index.parquet
    charts/
      calibration_curve.png
      error_decile_accuracy.png
      confidence_accuracy.png
      method_comparison.png
```

### 22.1 summary.md 必须包含

```text
1. 数据区间。
2. 样本数量。
3. 每个样本平均分身数量。
4. 最佳方法。
5. 最佳方法准确率。
6. 相对 Kronos 无筛选基线 lift。
7. 相对随机基线 lift。
8. Brier score。
9. Log loss。
10. 高置信度样本表现。
11. 路径误差分位表现。
12. 是否满足进入 V2 的标准。
```

---

## 23. 通过标准

V1 不能只看某个漂亮数字。

建议通过标准如下。

### 23.1 必须满足

```text
1. 路径筛选方法优于 Kronos 全体等权投票。
2. 路径筛选方法优于简单动量基线。
3. 路径误差最低分位的第12根准确率高于误差最高分位。
4. 高置信度样本准确率高于低置信度样本。
5. 测试期表现不是只在训练期有效。
```

### 23.2 理想表现

```text
整体准确率：52% 以上
高置信度样本：55% 以上
相对无筛选 Kronos：提升 1% 到 3%
路径误差分位：存在可解释的单调关系
Brier score：优于 0.25
```

注意：

```text
52% 不是一定可实盘的标准。
它只说明模型可能有弱 edge。
是否能在 Polymarket 赚钱，还要看 V2 的市场价格和成本。
```

### 23.3 失败标准

如果出现以下情况，应暂停进入 V2：

```text
1. 所有方法都接近 50%，且置信区间包含 50%。
2. TopK/加权不优于无筛选 Kronos。
3. 匹配误差和第12根准确率没有关系。
4. 高置信度样本不比低置信度样本更准。
5. 只有某个极小样本分组表现好，扩大样本后消失。
```

---

## 24. 开发里程碑

### Milestone 1：数据层

目标：

```text
能够下载、保存、读取 Binance 1H K 线。
```

产出：

```text
binance_downloader.py
candle_store.py
quality_check.py
```

验证：

```text
BTCUSDT/ETHUSDT 最近 30 天数据完整。
```

### Milestone 2：样本构建

目标：

```text
正确构建 input、known_path、target。
```

产出：

```text
sample_builder.py
test_no_future_leak.py
```

验证：

```text
任意样本都不包含未来数据。
```

### Milestone 3：基线模型

目标：

```text
先不用 Kronos，完成随机、上一根延续、最近N根动量等基线。
```

产出：

```text
baselines.py
metrics.py
```

验证：

```text
可以生成一份 baseline 回测报告。
```

### Milestone 4：Kronos Wrapper

目标：

```text
封装 Kronos 推理，支持多路径输出和缓存。
```

产出：

```text
kronos/wrapper.py
kronos/prediction_cache.py
```

验证：

```text
对单个样本生成 12 根预测路径。
重复运行时命中缓存。
```

### Milestone 5：路径匹配

目标：

```text
计算预测前 11 根与真实前 11 根误差。
```

产出：

```text
features/kline_features.py
matching/path_error.py
matching/weighting.py
```

验证：

```text
人工构造完全相同路径，误差接近 0。
人工构造反向路径，误差明显更高。
```

### Milestone 6：聚合方法

目标：

```text
实现 Raw Vote、Top1、TopK、TopPercent、Softmax Weighted。
```

产出：

```text
ensemble methods
```

验证：

```text
同一批分身可以输出不同方法的 q_up。
```

### Milestone 7：评估与报告

目标：

```text
输出完整 V1 报告。
```

产出：

```text
metrics_overall.csv
confidence_bins.csv
calibration_bins.csv
error_deciles.csv
summary.md
charts
```

验证：

```text
用 7 天 smoke 数据跑通完整流程。
```

### Milestone 8：Research Run

目标：

```text
用 3 个月 BTC/ETH 数据跑出初步结论。
```

验证：

```text
判断是否值得扩大到 formal run。
```

### Milestone 9：Formal Run

目标：

```text
用 6 到 12 个月数据做正式评估。
```

验证：

```text
决定是否进入 V2 Polymarket 历史价格回测。
```

---

## 25. CLI 命令设计

下载数据：

```bash
python -m src.data.binance_downloader \
  --symbols BTCUSDT ETHUSDT \
  --interval 1h \
  --start 2025-01-01 \
  --end 2026-05-01
```

检查数据：

```bash
python -m src.data.quality_check \
  --data-dir data/raw/binance \
  --symbols BTCUSDT ETHUSDT
```

运行 smoke 回测：

```bash
python -m src.backtest.runner \
  --config configs/smoke.yaml
```

运行 research 回测：

```bash
python -m src.backtest.runner \
  --config configs/research.yaml
```

生成报告：

```bash
python -m src.evaluation.report \
  --run-id run_2026xxxx_xxxxxx
```

---

## 26. 核心伪代码

```python
def run_backtest(config):
    candles_by_symbol = load_candles(config.data)
    results = []

    for symbol, candles in candles_by_symbol.items():
        samples = build_samples(candles, config.sample)

        for sample in samples:
            all_paths = []

            for kronos_config in config.kronos.config_grid:
                paths = kronos_predict_with_cache(
                    model_input=sample.model_input,
                    horizon=12,
                    kronos_config=kronos_config,
                    target_time=sample.target_open_time,
                    symbol=symbol,
                )

                for path in paths:
                    known_pred = path[:11]
                    target_pred = path[11]

                    error = compute_path_error(
                        predicted=known_pred,
                        actual=sample.known_true,
                        config=config.matching,
                    )

                    pred_up_post_open = target_pred.close > sample.target_open
                    pred_up_pre_open = target_pred.close > target_pred.open

                    all_paths.append({
                        "path": path,
                        "error": error,
                        "pred_up_post_open": pred_up_post_open,
                        "pred_up_pre_open": pred_up_pre_open,
                        "kronos_config": kronos_config,
                    })

            method_outputs = {}

            for method in config.ensemble.methods:
                q_up = aggregate_paths(
                    paths=all_paths,
                    method=method,
                    target_mode=config.sample.target_mode,
                )

                method_outputs[method.name] = {
                    "q_up": q_up,
                    "pred_up": q_up > 0.5,
                }

            baseline_outputs = run_baselines(sample)

            results.append({
                "symbol": symbol,
                "target_time": sample.target_open_time,
                "actual_up": sample.actual_up,
                "method_outputs": method_outputs,
                "baseline_outputs": baseline_outputs,
                "path_error_stats": summarize_errors(all_paths),
            })

    save_results(results)
    generate_report(results, config)
```

---

## 27. 必须防止的错误

### 27.1 未来函数

错误示例：

```text
模型输入包含 candle[i-11] 到 candle[i-1]。
```

这会破坏整个验证。

正确：

```text
模型输入最多到 candle[i-12]。
```

### 27.2 使用未收盘 K 线

回测中不能使用当前未完成 K 线作为历史输入。

### 27.3 用目标 close 做筛选

绝对禁止在路径匹配时使用 candle[i] 的 close。

路径匹配只能使用：

```text
candle[i-11] 到 candle[i-1]
```

### 27.4 只报告最优参数

如果测试了 100 组参数，只报告最好的那组，会严重过拟合。

必须报告：

```text
所有主要方法结果
验证期选择过程
测试期最终结果
```

### 27.5 忽略样本数量

如果某个高置信度分组只有 20 个样本，不能据此认为有效。

每个重要分组最好至少有：

```text
200 个以上样本
```

---

## 28. V1 完成后的决策

### 情况 A：明显通过

表现：

```text
路径筛选优于无筛选 Kronos。
高置信度样本更准。
误差分位有单调关系。
测试期仍然有效。
```

下一步：

```text
进入 V2，接入 Polymarket 历史价格和盘口数据。
```

### 情况 B：部分通过

表现：

```text
只在某些币种、某些波动状态、某些时间段有效。
```

下一步：

```text
缩小策略范围。
只研究有效市场状态。
加入行情过滤器。
```

例如：

```text
只做高波动时段。
只做 ETH。
只做趋势强的小时。
只做路径分歧低的样本。
```

### 情况 C：完全失败

表现：

```text
所有路径筛选方法都不优于基线。
误差分位和第12根准确率无关。
高置信度样本不更准。
```

下一步：

```text
不进入实盘。
不继续做自动下单。
考虑换模型、换周期、换目标或换市场。
```

---

## 29. V1 最小可执行版本

如果要最快开始，可以先做一个极简 MVP：

```text
1. 下载 BTCUSDT 最近 30 天 1H K 线。
2. 每隔 6 小时取一个目标样本，降低计算量。
3. 每个样本生成 20 条 Kronos 路径。
4. 使用 body_return + direction 计算前 11 根误差。
5. 比较 Raw Vote、Top1、Top5、Top10 Weighted。
6. 输出 accuracy、Brier、error decile。
```

这个版本不追求结论可靠，只追求：

```text
流程跑通
索引正确
缓存可用
报告能生成
```

MVP 跑通后，再逐步扩大。

---

## 30. 一句话总结

V1 回测系统要验证的不是 Kronos 某一次预测是否准确，而是：

```text
当 Kronos 生成大量未来路径时，
那些前 11 根更像真实市场的路径，
是否真的对第 12 根方向更有预测力。
```

如果这个假设成立，后续才有资格继续做：

```text
概率校准 -> Polymarket 价格比较 -> EV 决策 -> paper trading -> 小资金实盘
```

如果这个假设不成立，系统应该停在研究阶段，而不是继续开发自动下单功能。
