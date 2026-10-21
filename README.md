# 智谱模型嗅探站（GLM Model Probe）

一个**纯静态**网站：比较智谱 API 对不同候选名称的响应。浏览器直连智谱 API，无需项目自建后端。响应仅能说明当前 Key、端点和请求体下的网关行为，不能单独预测模型发布时间。

## 原理

向智谱 `chat/completions` 接口发送 `max_tokens=1` 的最小请求，不同模型名会产生可区分的错误信号：

| 响应形态 | 含义 | 分类 |
| --- | --- | --- |
| HTTP 200 | 模型对当前 Key 开放可用 | 🟢 已开放 |
| 明确的 1213 / 1220 或无权访问消息 | 当前 Key 被拒访问 | 无权访问 |
| 1113 / 余额不足或无可用资源包 | 当前请求遇到计费或资源资格障碍 | 计费受阻 |
| 接口不匹配消息 | 可能与模型名称有关，仍需同载荷对照 | 待复核 |
| 「模型不存在」类错误 | 名字不存在 | 🚫 不存在 |
| 限流 / 网络错误 | 无法判定，可重试 | 🌫 无法判定 |

无权访问与计费受阻都值得跟踪，但均不能单独推断模型已部署或即将发布。

由于智谱未公开文档化每个错误码的精确语义，分类器采用**自适应设计**：

1. **错误形态校准**：每轮扫描先用随机乱名发送与候选相同的常规请求；只有明确返回 `1211` 才接受校准，否则停止扫描。
2. **计费对照**：可手动用已开放的付费模型 `glm-5.3` 检查当前 Key 在通用 API 的支付能力。该请求可能计费；结果仅在同一 Key 的十分钟内附到扫描记录。
3. **空消息对照**：结果卡可按需对候选和随机乱名各发送一次 `messages: []`。乱名 `1211`、候选 `1214` 只支持“网关区别处理该名称”，不证明推理后端已运行。
4. **证据留存**：结果记录 Key 的 SHA-256 截断指纹、端点、载荷、原始响应与最近十次同条件历史；只有同条件的状态差异才高亮。

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
- **对照基线**：按 Key 保存官方 `/models` 列表，提示新返回的名称；每轮扫描必须重新用随机乱名验证 `1211`；可选付费模型计费对照。历史校准只供查看。
- **候选策略**：保留远端新增的 `glm-<版本>-preview`、多模态及 vidu 等候选，同时恢复 `glm-x-preview-{a..z}` 26 个字面代号，便于复测用户观察到的 a/f/g/k 差异。（2026-10-19 复核并实测：字母组 {a,f,g,k} 仍存活——a/k 绑计费 1113、f/g 无权 1220；版本组补入 **`glm-4.7-preview` 实测存活**（1113 绑计费）；`glm-4.6-air` 已观测 1220→1211 摘牌。调查全记录见 `docs/INVESTIGATION.md`。）另设 **线报高优组**（2026-10-21，置顶且探测最先后行）：`glm-5.4 → glm-5.4-flash → glm-5.5 → glm-5.5-flash`，按可能性递减（主线无跳版先例、5.3 与 Flash 同日发布先例）；当日实测均 1211——智谱习惯发布时才注册名字，「不存在」恰是发布前夜的正常状态，转 1113/1220/200 即发布信号。
- **免 Key 旁路通道**：① **扫描 zai-org 新开源仓库**——HuggingFace API 对页面 Origin 开放 CORS（实测），浏览器直读最近 50 个仓库，近 30 天新增的名字高亮并给出「仓库名 → 可试 API 名」提示（如 `GLM-5.3-Flash-BF16 → glm-5.3-flash-bf16`）；② **导出文档页探测脚本**——docs.bigmodel.cn 的文档页 404/200 是免 Key 存在性信号，但浏览器直连被 CORS 拦截（实测），一键导出本机 curl 脚本逐候选探测 text / vlm 两类页面
- **嗅探引擎**：可调并发（1–4）与间隔（200ms–2s）、进度条、限流自动重试、Key 失效自动停止
- **结果面板**：六种响应分类加总数统计、分类过滤、同条件响应变化、空消息对照、JSON / CSV 导出、localStorage 持久化

## 本地预览

纯静态页面，任意静态服务器均可，例如：

```bash
cd zhipu-model-sniffer
python3 -m http.server 8787 --directory public
# 打开 http://localhost:8787
```

## 使用流程

1. **① API Key**：粘贴 [智谱开放平台](https://www.bigmodel.cn/apikey/platform) 的 Key → 保存 → 点「验证有效性」（用免费模型零成本确认）
2. **② 对照基线**：按需拉取官方模型列表、运行可能计费的支付能力对照；扫描会自动重新校准 `1211`。无 Key 时仍可使用 HuggingFace 仓库扫描和文档页探测脚本。
3. **③ 候选名单**：勾选内置词典 / 添加自定义 / 用生成器批量构造
4. **④ 开始嗅探**：选并发与间隔 → 启动；对异常名称按需运行空消息对照并导出原始证据

## 成本与安全

- 嗅探请求 `max_tokens=1` 且内容仅 `hi`，只限制输出长度；输入 token 与额外对照请求仍可能计费。
- 请求从每个访客自己的浏览器、自己的 IP、自己的 Key 发出，来源天然分散；前端默认并发 2、间隔 500ms，请勿调高后高频滥用
- Key 保存在该站点的浏览器 localStorage，浏览器会把它发送给智谱 API；同源脚本也能读取它。使用前应信任站点代码与浏览器环境。
- 仅供学习研究，结果为概率性推断，以智谱官方发布为准

## 文件结构

```
zhipu-model-sniffer/
├── public/                       # 站点源文件（main 分支）
│   ├── index.html                # 单页布局
│   ├── app.js                    # 页面控制、请求引擎与直连智谱逻辑
│   ├── probe-logic.js            # 可离线测试的保守分类与对照逻辑
│   ├── candidates.js             # 版本 preview、字面代号及其他候选 + 生成器选项
│   └── style.css                 # 深色主题样式
├── docs/deploy.yml.sample        # （可选）Actions 自动部署工作流样本
├── README.md
└── gh-pages 分支                  # 部署内容 = public/ 平铺 + .nojekyll
```

离线回归：`node --test tests/*.test.cjs`。测试只使用模拟响应，不调用真实 API。
