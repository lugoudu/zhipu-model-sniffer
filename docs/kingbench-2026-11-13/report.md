# KingBench 4 截图：离线图像取证报告

日期：2026-11-13。所有分析均为本地计算；未联网，未探测任何 API。原图未修改。

## 结论先行

**名称未达到可靠还原标准。** 在本次有限候选库及字体模型下，三行共同的最佳前缀是 **`GLM Stone`**，但这只是正向像素匹配冠军，不是辨认出的官方名称。`Stone` 是本次扩展词库生成的测试词，没有独立情报佐证。不能把它写成“智谱即将发布 GLM Stone”。

| 块／名次 | 有限候选库第一名全文 | 前缀 NRMSE ↓ | 对精确名称的置信度 |
| --- | --- | --- | --- |
| A／2 | GLM Stone Pro | 0.06005 | 低；主观不超过 10%，非统计后验 |
| B／4 | GLM Stone Med | 0.05943 | 低；主观不超过 10%，非统计后验 |
| C／9 | GLM Stone Small | 0.06029 | 低；主观不超过 10%，非统计后验 |

**较稳妥的内容结论：** 三个清晰后缀分别是 Pro、Med、Small，前缀一致；其字形结构与 `GLM` 后接另一个词／代号相容。单独 `GLM-5.5` 在标定字号下过短、匹配明显较差。不能据此排除底层模型最终叫 GLM-5.5，因为榜单可能使用临时代号或自定义展示名。

**分数综合判定：59.4%、57.1%、54.0%。** 条长与像素候选共同支持这些数值；其中 D 的数字仅凭模糊文字无法唯一读取。用户给定的 58.9/57.0/53.9 是待校验估计，本次原图测量不支持原样保留。

## 1. 证据与边界

- 输入：`origin.png`，1200×675，RGB；SHA-256：`a49c47487a7136c7de53978359e4b9c5721f57d714fb9fbced58d7cfe2fc2f0c`。
- 原图不包含定位网格线；没有删除或修补 x=100 的像素。
- API 历史、第三方曝光、维护者关系、3.8 天间隔、未发布模型归属等均为用户提供背景，本次不联网核验。不能从截图证明 API 已存在、参数规模或发布日期。
- 反卷积会放大噪声并形成伪笔画；正向模拟能比较假设，却无法证明候选库包含真名。NRMSE 不是概率，三个高度相似的块也不是三次独立命名观测。

## 2. 字体标定、像素匹配方法与验证

字体搜索覆盖系统 Helvetica 的 Regular/Bold/Light、Helvetica Neue 的 Regular/Bold/Light/Medium，以及 Arial Regular/Bold、Verdana、Tahoma、Trebuchet MS。清晰 `GLM-5.3` 的初步标定在 14–17 px 间按 0.25 px 搜索。最佳为 **Helvetica Regular 15.5 px**；数字为 Helvetica Bold 15.5 px。`GLM-5.3` 字体 advance 为 60.293 px，与约 59 px 的实墨宽相容；因此不能以原先 17–18 px、每字符 8.4 px 的近似值机械计算字符数。

PIL 以 4 倍分辨率排字，LANCZOS 下采样，然后使用三次插值做亚像素位移，再施加 `scipy.ndimage.gaussian_filter`。先位移后模糊，扩大渲染画布，并使用白底（零墨量）边界，避免裁剪边界反射或移动已截断的模糊尾部影响排名。文字灰度统一表示为墨量 `T=1-gray/255`。

模型：`P = a · Gaussian_sigma(shift(render(text))) + b`。通过最小二乘联合求 x/y 亚像素位移、sigma、墨量增益 a 和背景 b。最终名称比较使用字号 15.25/15.5/15.75、Helvetica/Arial Regular/Bold；增益 a 限于 0.3–1.05、背景 b 限于 ±0.01、水平位移限于校准位置附近（基准渲染 x=8，额外位移 2–6 px）。这样不会靠任意拉宽字体或无界加深灰度使短名称“匹配”。分数比较允许较宽的位移／灰度范围，结果另用条长约束复核。

差分得分：`NRMSE = sqrt(sum((P-T)^2) / sum((T-mean(T))^2))`，越低越好。另保存归一化灰度 RMSE；乘 255 可换算成灰度级。标签最终比较区域为 x=[48,147)，A/B/C 的 y 分别为 [152,188)、[215,251)、[371,407)，避开清晰后缀。

| 验证对象 | 人工追加模糊 σ | 第一名 | 第一名 NRMSE | 第二名及 NRMSE |
| --- | --- | --- | --- | --- |
| GLM-5.3 | 0 | GLM-5.3 | 0.15921 | GLM-5.8 / 0.23293 |
| GLM-5.3 | 2 | GLM-5.3 | 0.05052 | GLM-5.5 / 0.09596 |
| GLM-5.3 | 4 | GLM-5.3 | 0.03348 | GLM-5.5 / 0.04380 |
| Opus 5.5 | 0 | Opus 5.5 | 0.21461 | Opus 5.6 / 0.26730 |
| Opus 5.5 | 2 | Opus 5.5 | 0.06630 | Opus 5.3 / 0.09095 |
| Opus 5.5 | 4 | Opus 5.5 | 0.04933 | Opus 5.3 / 0.05028 |

验证通过：`GLM-5.3` 和 `Opus 5.5` 在清晰图、σ=2 和 σ=4 的人工模糊图中均排第一。完整验证候选及分数见 [validation_final.json](tables/validation_final.json)。这是同源字体下的正对照，不是对未知名称的正确率认证。

## 3. 直接反卷积与图像文件

6 个块都包含周边留白，标签右侧截止于 x=147 以避开清晰后缀；分数左侧避开黑色条形。裁剪框采用 PIL 半开区间：A=(45,149,147,194)，B=(45,212,147,257)，C=(45,368,147,413)，D=(905,149,976,194)，E=(881,212,952,257)，F=(848,368,919,413)。处理时再添加 24 px 反射 padding；反卷积后去掉 padding。

完整扫描：σ=0.8–3.0，步长 0.1；因正向拟合需要更宽的核，继续扫描 σ=3.1–4.5，步长 0.1。PSF 为截断于 4σ 的归一化二维高斯。每个 σ 做 RL 10/30/80 次迭代，以及 Wiener balance=0.003/0.01/0.03。另在 σ=3.8/4.0/4.2 做 RL 300/1000、Wiener 10⁻⁶/10⁻⁵/10⁻⁴ 的激进对照。共保存 **1458 张单配置还原 PNG**，均以最近邻放大 4×，不增加原始信息。

“最优”只能相对于校准模型定义：用清晰 `GLM-5.3` 人工施加 σ=4 后恢复，并以原始清晰墨量 RMSE 选择正则强度；另做 8 bit 量化与固定随机种子噪声敏感性实验。量化／噪声会把 Wiener 的适宜 balance 从理想无噪声下的 10⁻⁶ 推向 10⁻⁴ 或 0.003。RL 1000 在这些合成测试中优于较少迭代，但真实图的过冲与伪笔画仍明显。因此保留温和组与激进组，不把残差更小等同于更真实。

| 块 | 原始裁剪 | 首选参数与敏感性对照 | 温和组 | 激进组（含严重伪影） |
| --- | --- | --- | --- | --- |
| A | [裁剪](crops/A_padded.png) | [六组拼图](deconvolution/A_recommended.png) | [查看](deconvolution/A_selected.png) | [查看](deconvolution/A_selected_aggressive.png) |
| B | [裁剪](crops/B_padded.png) | [六组拼图](deconvolution/B_recommended.png) | [查看](deconvolution/B_selected.png) | [查看](deconvolution/B_selected_aggressive.png) |
| C | [裁剪](crops/C_padded.png) | [六组拼图](deconvolution/C_recommended.png) | [查看](deconvolution/C_selected.png) | [查看](deconvolution/C_selected_aggressive.png) |
| D | [裁剪](crops/D_padded.png) | [六组拼图](deconvolution/D_recommended.png) | [查看](deconvolution/D_selected.png) | [查看](deconvolution/D_selected_aggressive.png) |
| E | [裁剪](crops/E_padded.png) | [六组拼图](deconvolution/E_recommended.png) | [查看](deconvolution/E_selected.png) | [查看](deconvolution/E_selected_aggressive.png) |
| F | [裁剪](crops/F_padded.png) | [六组拼图](deconvolution/F_recommended.png) | [查看](deconvolution/F_selected.png) | [查看](deconvolution/F_selected_aggressive.png) |

每块推荐文件名如下（都是算法输出，不能当作已识别文本）：

**块 A**

- [A_rl_s3.8_p1000.png](deconvolution/A_rl_s3.8_p1000.png)；回卷积 RMSE=0.00498。
- [A_rl_s4.0_p1000.png](deconvolution/A_rl_s4.0_p1000.png)；回卷积 RMSE=0.00503。
- [A_rl_s4.2_p1000.png](deconvolution/A_rl_s4.2_p1000.png)；回卷积 RMSE=0.00532。
- [A_wiener_s4.0_p0.0001.png](deconvolution/A_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00438。
- [A_wiener_s4.2_p0.0001.png](deconvolution/A_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00439。
- [A_wiener_s4.2_p0.003.png](deconvolution/A_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00453。

**块 B**

- [B_rl_s3.8_p1000.png](deconvolution/B_rl_s3.8_p1000.png)；回卷积 RMSE=0.00427。
- [B_rl_s4.0_p1000.png](deconvolution/B_rl_s4.0_p1000.png)；回卷积 RMSE=0.00438。
- [B_rl_s4.2_p1000.png](deconvolution/B_rl_s4.2_p1000.png)；回卷积 RMSE=0.00475。
- [B_wiener_s4.0_p0.0001.png](deconvolution/B_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00365。
- [B_wiener_s4.2_p0.0001.png](deconvolution/B_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00366。
- [B_wiener_s4.2_p0.003.png](deconvolution/B_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00376。

**块 C**

- [C_rl_s3.8_p1000.png](deconvolution/C_rl_s3.8_p1000.png)；回卷积 RMSE=0.00483。
- [C_rl_s4.0_p1000.png](deconvolution/C_rl_s4.0_p1000.png)；回卷积 RMSE=0.00495。
- [C_rl_s4.2_p1000.png](deconvolution/C_rl_s4.2_p1000.png)；回卷积 RMSE=0.00528。
- [C_wiener_s4.0_p0.0001.png](deconvolution/C_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00438。
- [C_wiener_s4.2_p0.0001.png](deconvolution/C_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00440。
- [C_wiener_s4.2_p0.003.png](deconvolution/C_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00447。

**块 D**

- [D_rl_s3.8_p1000.png](deconvolution/D_rl_s3.8_p1000.png)；回卷积 RMSE=0.00510。
- [D_rl_s4.0_p1000.png](deconvolution/D_rl_s4.0_p1000.png)；回卷积 RMSE=0.00507。
- [D_rl_s4.2_p1000.png](deconvolution/D_rl_s4.2_p1000.png)；回卷积 RMSE=0.00520。
- [D_wiener_s4.0_p0.0001.png](deconvolution/D_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00400。
- [D_wiener_s4.2_p0.0001.png](deconvolution/D_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00404。
- [D_wiener_s4.2_p0.003.png](deconvolution/D_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00438。

**块 E**

- [E_rl_s3.8_p1000.png](deconvolution/E_rl_s3.8_p1000.png)；回卷积 RMSE=0.00376。
- [E_rl_s4.0_p1000.png](deconvolution/E_rl_s4.0_p1000.png)；回卷积 RMSE=0.00382。
- [E_rl_s4.2_p1000.png](deconvolution/E_rl_s4.2_p1000.png)；回卷积 RMSE=0.00386。
- [E_wiener_s4.0_p0.0001.png](deconvolution/E_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00328。
- [E_wiener_s4.2_p0.0001.png](deconvolution/E_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00329。
- [E_wiener_s4.2_p0.003.png](deconvolution/E_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00335。

**块 F**

- [F_rl_s3.8_p1000.png](deconvolution/F_rl_s3.8_p1000.png)；回卷积 RMSE=0.00384。
- [F_rl_s4.0_p1000.png](deconvolution/F_rl_s4.0_p1000.png)；回卷积 RMSE=0.00388。
- [F_rl_s4.2_p1000.png](deconvolution/F_rl_s4.2_p1000.png)；回卷积 RMSE=0.00406。
- [F_wiener_s4.0_p0.0001.png](deconvolution/F_wiener_s4.0_p0.0001.png)；回卷积 RMSE=0.00327。
- [F_wiener_s4.2_p0.0001.png](deconvolution/F_wiener_s4.2_p0.0001.png)；回卷积 RMSE=0.00329。
- [F_wiener_s4.2_p0.003.png](deconvolution/F_wiener_s4.2_p0.003.png)；回卷积 RMSE=0.00335。

强 Wiener 出现大幅正负过冲、背景条纹；RL 高频结构也随 σ 与迭代数明显变化。没有一组能稳定逐字读出隐藏名称。直接反卷积的证据强度低于正向匹配。完整指标见 [deconvolution_metrics.csv](tables/deconvolution_metrics.csv)。PNG 为显示而截断到 0–255；未截断值的 min/max/roughness 均保存在指标表。

## 4. 隐藏名称：正向排名与反证

初始候选库包括用户要求的全部形态；随后扩展空格／连字符、GLM/Z.ai/Z.AI/Z-AI/ZAI、版本号、Air/Flash/Turbo、英文代号与占位符。扩展库构造了 2206 个去重字符串，粗筛实际评估 1355 个字符串、2312 个字体组合（新扩展的显著过长／过短名称被宽度筛除；原始必需候选保留）。取粗排前 45 个不同名称加必需候选细化 A；B/C 用 A 的前 15 名加必需候选复核。因此下表是有限检索与字体模型下的排名，不是所有可能字符串的全局排名。

### 块 A 前五名

| 序 | 前缀候选 | NRMSE ↓ | 灰度 RMSE ×255 | 字体／字号 | σ |
| --- | --- | --- | --- | --- | --- |
| 1 | GLM Stone | 0.06005 | 1.957 | Helvetica Bold / 15.5 | 4.205 |
| 2 | GLM-Stone | 0.06679 | 2.177 | Helvetica Bold / 15.25 | 4.175 |
| 3 | GLM Quick | 0.07449 | 2.428 | Helvetica Bold / 15.5 | 4.161 |
| 4 | GLM Storm | 0.07461 | 2.432 | Helvetica Bold / 15.25 | 4.177 |
| 5 | GLM Alpha | 0.07590 | 2.474 | Arial Bold / 15.5 | 4.150 |

[最佳正向模拟与残差](fits/boundary_A_1.png)：从上到下为真实模糊块、候选正向模拟、放大残差。**正向模拟不是恢复出的原文字。**

### 块 B 前五名

| 序 | 前缀候选 | NRMSE ↓ | 灰度 RMSE ×255 | 字体／字号 | σ |
| --- | --- | --- | --- | --- | --- |
| 1 | GLM Stone | 0.05943 | 1.937 | Helvetica Bold / 15.5 | 4.215 |
| 2 | GLM-Stone | 0.06706 | 2.186 | Helvetica Bold / 15.25 | 4.184 |
| 3 | GLM Quick | 0.07398 | 2.411 | Helvetica Bold / 15.5 | 4.168 |
| 4 | GLM Storm | 0.07407 | 2.414 | Helvetica Bold / 15.25 | 4.180 |
| 5 | GLM Azure | 0.07620 | 2.484 | Helvetica Bold / 15.5 | 4.217 |

[最佳正向模拟与残差](fits/boundary_B_1.png)：从上到下为真实模糊块、候选正向模拟、放大残差。**正向模拟不是恢复出的原文字。**

### 块 C 前五名

| 序 | 前缀候选 | NRMSE ↓ | 灰度 RMSE ×255 | 字体／字号 | σ |
| --- | --- | --- | --- | --- | --- |
| 1 | GLM Stone | 0.06029 | 1.961 | Helvetica Bold / 15.5 | 4.227 |
| 2 | GLM-Stone | 0.06824 | 2.220 | Helvetica Bold / 15.25 | 4.198 |
| 3 | GLM Quick | 0.07444 | 2.422 | Helvetica Bold / 15.5 | 4.179 |
| 4 | GLM Storm | 0.07535 | 2.451 | Helvetica Bold / 15.25 | 4.194 |
| 5 | GLM Alpha | 0.07718 | 2.511 | Arial Bold / 15.5 | 4.170 |

[最佳正向模拟与残差](fits/boundary_C_1.png)：从上到下为真实模糊块、候选正向模拟、放大残差。**正向模拟不是恢复出的原文字。**

### 必需候选的对照（A 块）

| 候选 | NRMSE ↓ | 拟合文本 advance / px |
| --- | --- | --- |
| GLM-5.5 | 0.54372 | 62.13 |
| GLM-5.4 | 0.54888 | 62.13 |
| GLM-6 | 0.75464 | 49.00 |
| GLM-5.5 Air | 0.22734 | 85.02 |
| GLM-5.5 Turbo | 0.35514 | 109.95 |
| GLM-5.5 Flash | 0.36874 | 107.64 |
| GLM-Next | 0.24082 | 74.38 |
| GLM-5 | 0.75552 | 49.00 |
| GLM-5 5.5 | 0.27895 | 75.26 |
| Z.ai Next | 0.49293 | 65.64 |
| Z.ai Model | 0.29527 | 77.00 |
| Z.ai GLM-5.5 | 0.35251 | 93.63 |

最关键的反证是：同字号 `GLM-5.5` 的 advance 约 60–62 px，而隐藏区域需要约 80 多 px 的文本。允许亚像素位移、合理灰度和模糊宽度变化仍不能补出这段长度。若原作者对隐藏名称单独改变字体大小、横向拉伸、插入不可见占位或另有图形处理，本模型的排除力会降低；本次没有把这些额外自由度当作默认事实。

原先“词团 1 约 5 字符、词团 2 约 5 字符”的解释不唯一。G/L/M 本身宽度与墨量差异很大，L 的竖笔及底边会形成墨量低谷；模糊外扩后，约 41 px 的团块完全可能来自 `GLM` 三个较宽字符。灰度较淡也不足以证明是 Regular：模糊会降低局部峰值，本次前排候选更支持 Bold。

A/B 原始块相关系数 0.995098，A/C 为 0.998090；亚像素／灰度对齐后的 RMSE 分别为 0.00469、0.00496。这支持共用前缀，但不会把候选真名的概率乘三。

还测试了 240 个固定随机种子生成的无意义五字母词，例如 `GLM Nfzce` 的 NRMSE=0.09006。其分数虽未超过最佳词，却接近多项自然词候选，展示了模糊图的非唯一性。最初窄词库的第一名是 GLM Alpha，扩展后变为 GLM Stone；这种词库依赖本身就是降低置信度的理由。

**可交付的命名判断：** 若必须从本次词库选择，依次填 `GLM Stone Pro` / `GLM Stone Med` / `GLM Stone Small`；必须同时标记“低置信度像素候选，精确名称主观不超过 10%”。更适合实际情报记录的是 `[同一未知前缀] Pro/Med/Small`。对 `GLM` 起首为中等信心，对第二个词不做已识别声明。

## 5. 分数 D/E/F：像素与条长交叉验证

用清晰 `57.8%` 标定数字字体；每块独立扫描 45.0%–70.0%、步长 0.1（251 个数值，未将用户先验数值固定为答案）。以下前五名为像素匹配分数，尚未应用榜单顺序与条长约束。

### 块 D 像素前五名

| 序 | 候选 | NRMSE ↓ | σ |
| --- | --- | --- | --- |
| 1 | 50.4% | 0.03972 | 4.214 |
| 2 | 56.4% | 0.04212 | 4.272 |
| 3 | 59.4% | 0.04219 | 4.201 |
| 4 | 60.4% | 0.04422 | 4.280 |
| 5 | 69.4% | 0.04524 | 4.260 |

### 块 E 像素前五名

| 序 | 候选 | NRMSE ↓ | σ |
| --- | --- | --- | --- |
| 1 | 57.1% | 0.04730 | 4.250 |
| 2 | 51.1% | 0.06486 | 4.388 |
| 3 | 47.1% | 0.06582 | 4.353 |
| 4 | 67.1% | 0.06739 | 4.334 |
| 5 | 61.1% | 0.07249 | 4.483 |

### 块 F 像素前五名

| 序 | 候选 | NRMSE ↓ | σ |
| --- | --- | --- | --- |
| 1 | 54.0% | 0.04640 | 4.191 |
| 2 | 64.9% | 0.04751 | 4.309 |
| 3 | 54.5% | 0.04810 | 4.221 |
| 4 | 64.0% | 0.04984 | 4.270 |
| 5 | 54.9% | 0.05229 | 4.235 |

格式对照覆盖省略 %、插入空格、整数百分数、两位小数、逗号小数和 pts。无 %、整数或多一位小数通常明显较差；逗号与点在强模糊下仍可能接近，但整张榜单清晰行一致使用小数点。因此 **NN.N%** 是高置信度格式判断，不能单靠模糊图声称百分号每一笔或小数点形状均已读出。

条长标定使用图中 13 条可见分数，逐行在条形中心扫描到灰度阈值 240 的右端，回归得到：

`x_right = 265.397746 + 10.745315 × pct`

右端回归残差 RMS 为 0.277 px（约 0.026 个百分点）。屏幕像素取整、端点阈值及显示分数四舍五入仍会带来额外误差；这不是精确统计置信区间。

| 分数块／条形 | 右端 x | 条长反推 | 综合选定 | 该候选像素 NRMSE | 主观置信度 |
| --- | --- | --- | --- | --- | --- |
| D/A | 903.5 | 59.3842% | 59.4% | 0.04219 | 高，约 95% |
| E/B | 879.5 | 57.1507% | 57.1% | 0.04730 | 较高，约 85% |
| F/C | 845.5 | 53.9865% | 54.0% | 0.04640 | 高，约 95% |

D 的纯像素第一名可能是 50.4% 等相似数字；这些数值与第 2 名的条长及排序不符。59.4% 是综合选择，绝不表述为 D 已被独立 OCR 唯一读出。E 的条长估计位于 57.1/57.2 的舍入边界附近，像素拟合明显偏向 57.1%；F 的条长支持 54.0%。置信度为主观判断，不能当作校准概率。

## 6. 显示名、官方命名与 API id

以下历史信息采用用户给出的命名史：air、flash、flashx 曾用于智谱变体，Med/Medium 未见于该历史列表；用户还提出 turbo 作为对照，但给出的已知 API 清单没有 turbo，因此不能将其升级为本次已核验历史事实。

**倾向判断：榜单作者的三档简称或临时测试标签，比已确认的官方 Pro/Med/Small 命名切换更有依据。** 理由是三个后缀形成整齐的尺寸／档位序列，Med 尤其像 Medium 的界面缩写；它们与既有 air/flash/flashx 的产品语义没有一对一关系。Pro 可以表示旗舰／高预算，Med 可能表示中档，Small 可能表示小模型／低预算，但也可能区分同一模型的推理预算，不能由名字推定参数量。

官方同步更换三档命名仍是可行假设，只是截图不能决定其真假。更不能由 “Med” 推出 API 必为 `-med`：可能用 `-medium`、继续 `-air`、采用其他 ID，或根本不公开该档。对 Pro→pro、Med→med/medium、Small→small 的映射只提供待试假设。

从用户的版本演进背景看，`glm-5.5` 值得优先测试；这来自命名与第三方线索先验，而非本次像素确认。`glm-6` 为次级代际假设。`glm-stone` 只来源于有限候选库拟合，优先级必须低于有独立先验的版本号；不建议把所有可拟合英文词都加入高频探测。

## 7. 嗅探站建议名单（仅生成，未执行）

**P1：优先，版本先验／用户提供旁证**

```text
glm-5.5
glm-5.5-flash
glm-5.5-pro
glm-5.5-air
```

**P2：三档映射与预览形式，均未证实**

```text
glm-5.5-med
glm-5.5-medium
glm-5.5-small
glm-5.5-preview
glm-5.5-flashx
```

**P3：其他版本／产品变体，较弱先验**

```text
glm-6
glm-6-pro
glm-6-med
glm-6-medium
glm-6-small
glm-5.4
glm-5.4-pro
glm-5.4-med
glm-5.4-small
glm-5.5-turbo
```

**P4：仅像素代号假设，低频探索**

```text
glm-stone
glm-stone-pro
glm-stone-med
glm-stone-medium
glm-stone-small
glm-next
```

保留既有 `glm-x-preview-a/f/g/k` 作为已知形态对照（其“曾存在”来自用户背景，当前是否可用未核验）。如扩展此类代号，可另列 `glm-x-preview-{b,c,d,e,h,i,j,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z}`；字母本身无法由截图排序，因此不要伪造优先级。错误响应、鉴权失败或平台本地配置拒绝都不能单独证明 ID 存在。

可直接读取有序名单：[probe_ids.txt](probe_ids.txt)。没有向任何端点发请求，也未修改嗅探站配置。

## 8. 文件与复现

- [原图及裁剪总览](crops/overview.png)
- 最终名称数据：[labels_boundary.json](tables/labels_boundary.json)；完整粗筛：[labels_expanded.json](tables/labels_expanded.json)；随机词对照：[null_controls.json](tables/null_controls.json)。
- 分数全扫描：[scores.json](tables/scores.json)；最终复核：[scores_boundary.json](tables/scores_boundary.json)；条长数据：[bars.json](tables/bars.json)。
- [字体标定](tables/font_calibration.json)、[最终正对照](tables/validation_final.json)、[反卷积无噪声校准](tables/deconv_benchmark.json)、[量化与噪声校准](tables/deconv_noise_benchmark.json)。
- 所有单配置图的文件名／参数／回卷积误差：[deconvolution_metrics.csv](tables/deconvolution_metrics.csv)。
- 脚本保存在 `scripts/`；最终匹配实现为 `scripts/analyze.py` 中的 `fit`。保留了部分初轮输出用于审计，结论只使用带 `boundary` 的最终复核表。

主要复现顺序（全为本地 Python）：

```sh
/Users/wangnan/miniforge3/bin/python3 scripts/analyze.py
/Users/wangnan/miniforge3/bin/python3 scripts/match_labels.py
/Users/wangnan/miniforge3/bin/python3 scripts/expand_labels.py
/Users/wangnan/miniforge3/bin/python3 scripts/match_scores.py
/Users/wangnan/miniforge3/bin/python3 scripts/final_checks.py
/Users/wangnan/miniforge3/bin/python3 scripts/deconvolve.py
/Users/wangnan/miniforge3/bin/python3 scripts/extended_deconv.py
/Users/wangnan/miniforge3/bin/python3 scripts/aggressive_deconv.py
/Users/wangnan/miniforge3/bin/python3 scripts/noise_benchmark.py
/Users/wangnan/miniforge3/bin/python3 scripts/build_report.py
```

工具版本：Python 使用 `/Users/wangnan/miniforge3/bin/python3`；numpy 2.4.2、scipy 1.17.1、scikit-image 0.26.0、Pillow 12.2.0。没有使用生成式图像模型来“补字”。
