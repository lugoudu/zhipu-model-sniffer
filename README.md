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

## 部署与更新（gh-pages 分支模式，当前线上方案）

线上地址：<https://lugoudu.github.io/zhipu-model-sniffer/>

仓库采用**双分支**结构：

- `main`：源码分支（`public/` 为站点源文件，`README.md`、`docs/` 等仅存于此）
- `gh-pages`：部署分支（站点根，内容 = `public/` 平铺 + `.nojekyll`），GitHub Pages 从该分支构建

> 之所以不用 GitHub Actions 工作流：推送 `.github/workflows/` 需要 token 具备 `workflow` scope，当前 gh CLI token（gist, read:org, repo）不具备。工作流样本保留在 `docs/deploy.yml.sample`，若将来想改为 Actions 自动部署，把它移回 `.github/workflows/deploy.yml` 并在 Settings → Pages 把 Source 切到 GitHub Actions 即可。

**更新站点的操作**（改完 `public/` 下文件后）：

```bash
cd zhipu-model-sniffer
git checkout main
# ...修改 public/ 下的文件，提交...
git push
git checkout gh-pages
git rm -q app.js candidates.js index.html style.css 2>/dev/null
cp public/* . && git add -A && git commit -m "deploy: update site" && git push
git checkout main
```

> ⚠️ 凡改动 `public/candidates.js` / `public/app.js`，必须完整执行上方 gh-pages 同步命令，README 中的候选计数随改随更（以 `public/candidates.js` 实际计数为准）。

**从零复现部署**（新机器 / 新仓库）：

```bash
git init -b main && git add -A && git commit -m "init"
gh repo create zhipu-model-sniffer --public --source=. --push
git checkout -b gh-pages && git rm -rf -q . && git checkout main -- public/
cp -r public/* . && touch .nojekyll && git add -A && git commit -m "deploy" && git push -u origin gh-pages
# Settings → Pages → Source 选 "Deploy from a branch" → gh-pages / (root)
```

## 功能

- **API Key 管理**：输入、保存（浏览器 localStorage）、显示/隐藏、免费模型验证（`FREE_MODELS` 按序回退，旧免费模型下线后不会永远报错）、一键清除；嗅探请求由用户浏览器直连智谱，本站（以及任何托管方）不经手 Key
- **对照基线**：拉取官方 `/models` 列表得到「已开放」名单（嗅探时可跳过；若官方列表出现内置词典未收录的新名字，会以提示条 + 日志反向 diff 告警——以拉取结果为准，SEED 仅是快照）；乱名校准「不存在」基线（校准撞上认证/限流/网络错误会被拒绝，防基线污染；基线持久化保存，超过 24 小时提示重新校准）
- **候选策略（2026-09 重建）**：glm 主线版本号 **≤ 5.2 的候选全部剔除**（旧模型无嗅探价值，专用线编号独立不受此限）；Preview 内测代号组改用**情报实锤的官方预发布形态 `glm-<版本>-preview`**（6 个，其中两个 `*-flash-preview` 为组合推测）——原字母扫描组 `glm-x-preview-{a..z}`（26 个，零证据）已删除；版本号外推补齐 flashx / turbo 档位；vidu 视频线改用官方定价页实锤调用名（`viduq1-*` / `vidu2-*`），并沿直进位规律外推 `vidu3-*`；其余为 5.3 后缀家族 / 多模态镜像等按命名规律外推的候选（生成器后缀含 `-preview` / `-long` / `-x` / `-thinking-flash` 等实锤形态，可按「版本 × 变体」自行构造）
- **免 Key 旁路通道**：① **扫描 zai-org 新开源仓库**——HuggingFace API 对页面 Origin 开放 CORS（实测），浏览器直读最近 50 个仓库，近 30 天新增的名字高亮并给出「仓库名 → 可试 API 名」提示（如 `GLM-5.3-Flash-BF16 → glm-5.3-flash-bf16`）；② **导出文档页探测脚本**——docs.bigmodel.cn 的文档页 404/200 是免 Key 存在性信号，但浏览器直连被 CORS 拦截（实测），一键导出本机 curl 脚本逐候选探测 text / vlm 两类页面
- **嗅探引擎**：可调并发（1–4）与间隔（200ms–2s）、进度条、限流自动重试、Key 失效自动停止
- **结果面板**：六类统计、分类过滤、请求日志、JSON / CSV 导出、localStorage 持久化

## 本地预览

纯静态页面，任意静态服务器均可，例如：

```bash
cd zhipu-model-sniffer
python3 -m http.server 8787 --directory public
# 打开 http://localhost:8787
```

## 使用流程

1. **① API Key**：粘贴 [智谱开放平台](https://www.bigmodel.cn/apikey/platform) 的 Key → 保存 → 点「验证有效性」（用免费模型零成本确认）
2. **② 对照基线**：拉取官方模型列表（以拉取结果为准，SEED 仅是快照）→ 错误形态校准（强烈建议，基线持久化 24 小时）；没有 Key 时可用「扫描 zai-org 新开源仓库」与「导出文档页探测脚本」两条免 Key 旁路
3. **③ 候选名单**：勾选内置词典 / 添加自定义 / 用生成器批量构造
4. **④ 开始嗅探**：选并发与间隔 → 启动；关注 🔥「存在·无权」与 ⚡「疑似存在」

## 成本与安全

- 嗅探请求 `max_tokens=1` 且内容仅 `hi`：免费模型零成本；付费模型每次至多 1 个输出 token（候选总量以 `public/candidates.js` 实际计数为准，2026-09 重建后 64 个，单轮 < 0.01 元级别）
- 请求从每个访客自己的浏览器、自己的 IP、自己的 Key 发出，来源天然分散；前端默认并发 2、间隔 500ms，请勿调高后高频滥用
- Key 只存于访客自己的浏览器 localStorage；纯静态架构下不存在服务器中转环节
- 仅供学习研究，结果为概率性推断，以智谱官方发布为准

## 文件结构

```
zhipu-model-sniffer/
├── public/                       # 站点源文件（main 分支）
│   ├── index.html                # 单页布局
│   ├── app.js                    # 嗅探引擎 + 自适应分类器 + 直连智谱逻辑
│   ├── candidates.js             # 内置候选词典（以实际计数为准，2026-09 重建后 64 个）+ 生成器选项
│   └── style.css                 # 深色主题样式
├── docs/deploy.yml.sample        # （可选）Actions 自动部署工作流样本
├── README.md
└── gh-pages 分支                  # 部署内容 = public/ 平铺 + .nojekyll
```
