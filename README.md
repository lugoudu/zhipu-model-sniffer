# 智谱模型嗅探站（GLM Model Probe）

一个**纯静态**网站：通过「错误信号差异」嗅探智谱（bigmodel.cn）可能存在或即将发布的新模型。浏览器直连智谱官方 API（平台已开放 CORS，实测确认），无需任何服务器，可托管在 GitHub Pages 等静态平台随时访问。

## 原理

向智谱 `chat/completions` 接口发送 `max_tokens=1` 的最小请求，不同模型名会产生可区分的错误信号：

| 响应形态 | 含义 | 分类 |
| --- | --- | --- |
| HTTP 200 | 模型对当前 Key 开放可用 | 🟢 已开放 |
| 「无权访问 / 未授权 / 需申请」类错误 | **模型名通过了存在性校验，只是不让你用** | 🔥 存在·无权 |
| 「不支持该接口 / 计费 / 参数」类错误 | 报错发生在模型名校验之后，大概率存在 | ⚡ 疑似存在 |
| 「模型不存在」类错误 | 名字不存在 | 🚫 不存在 |
| 限流 / 网络错误 | 无法判定，可重试 | 🌫 无法判定 |

其中 🔥「存在·无权」价值最高——通常意味着内测中或即将发布的模型。

由于智谱未公开文档化每个错误码的精确语义，分类器采用**自适应设计**：

1. **错误形态校准**：嗅探前先发一个随机乱名（如 `probe-nonexist-x7k2`），记录「模型不存在」的真实报错形态（HTTP 状态 + 错误码签名）；
2. **基线比对**：任何候选的响应若与基线签名完全一致，强制归为「不存在」，避免文案变化导致的误报；
3. **原始证据展示**：每条结果都保留 HTTP 状态、错误码、原始消息与延迟，日志区可人工复核，分类只是辅助判断。

## 部署到 GitHub Pages（推荐，全程免费）

仓库已内置 GitHub Actions 工作流（`.github/workflows/deploy.yml`，以 `public/` 为站点根），三步上线：

1. 在 GitHub 新建一个仓库（**Public**——免费账号的 Pages 只支持公开仓库）
2. 推送本目录：

   ```bash
   cd zhipu-model-sniffer
   git init && git add -A && git commit -m "init: zhipu model sniffer"
   git remote add origin git@github.com:<你的用户名>/<仓库名>.git
   git branch -M main && git push -u origin main
   ```

3. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**（首次推送后工作流会自动运行，也可以在 Actions 页手动触发）

完成后访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。以后每次 `git push` 自动重新部署。

> 也可以用 `gh` CLI 一气呵成：`gh repo create zhipu-model-sniffer --public --source=. --push`，然后到 Settings → Pages 把 Source 切到 GitHub Actions。

## 功能

- **API Key 管理**：输入、保存（浏览器 localStorage）、显示/隐藏、免费模型验证、一键清除；嗅探请求由用户浏览器直连智谱，本站（以及任何托管方）不经手 Key
- **对照基线**：拉取官方 `/models` 列表得到「已开放」名单（嗅探时可跳过）；乱名校准「不存在」基线
- **候选名单**：内置 74 个按命名规律外推的候选（版本号 / air·plus·pro 变体 / V 多模态 / OCR / TTS / CogView / CogVideoX / Embedding 等 7 组）+ 自定义名单 + 「版本 × 变体」批量生成器
- **嗅探引擎**：可调并发（1–4）与间隔（200ms–2s）、进度条、限流自动重试、Key 失效自动停止
- **结果面板**：六类统计、分类过滤、请求日志、JSON / CSV 导出、localStorage 持久化

## 本地预览

纯静态页面，任意静态服务器均可，例如：

```bash
cd zhipu-model-sniffer
python3 -m http.server 8787 --directory public
# 打开 http://localhost:8787
```

> 仓库根目录还保留了早期的 `server.js`（本地代理版）。CORS 实测确认智谱已开放浏览器直连后，它已非必需，仅作为不想直连时的备选：`node server.js` 后访问其 8787 端口（注意它托管的是当时的直连前版本，如需使用请自行回退 `public/app.js` 中的直连逻辑）。

## 使用流程

1. **① API Key**：粘贴 [智谱开放平台](https://open.bigmodel.cn/usercenter/apikeys) 的 Key → 保存 → 点「验证有效性」（用免费模型零成本确认）
2. **② 对照基线**：拉取官方模型列表 → 错误形态校准（强烈建议）
3. **③ 候选名单**：勾选内置词典 / 添加自定义 / 用生成器批量构造
4. **④ 开始嗅探**：选并发与间隔 → 启动；关注 🔥「存在·无权」与 ⚡「疑似存在」

## 成本与安全

- 嗅探请求 `max_tokens=1` 且内容仅 `hi`：免费模型零成本；付费模型每次至多 1 个输出 token（约 74 个候选 < 0.01 元级别）
- 请求从每个访客自己的浏览器、自己的 IP、自己的 Key 发出，来源天然分散；前端默认并发 2、间隔 500ms，请勿调高后高频滥用
- Key 只存于访客自己的浏览器 localStorage；纯静态架构下不存在服务器中转环节
- 仅供学习研究，结果为概率性推断，以智谱官方发布为准

## 文件结构

```
zhipu-model-sniffer/
├── .github/workflows/deploy.yml  # GitHub Pages 自动部署（站点根 = public/）
├── public/
│   ├── index.html                # 单页布局
│   ├── app.js                    # 嗅探引擎 + 自适应分类器 + 直连智谱逻辑
│   ├── candidates.js             # 内置候选词典（74 个）+ 生成器选项
│   └── style.css                 # 深色主题样式
├── server.js                     # （遗留，可选）早期本地代理版
└── README.md
```
