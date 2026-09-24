/* 智谱模型嗅探站 —— 前端逻辑（无框架，原生 JS）
 *
 * 嗅探原理：
 *   对每个候选模型名发送一次 max_tokens=1 的 chat 请求，根据响应差异分类：
 *   - HTTP 200                    → 已开放可用
 *   - “模型不存在”类错误          → 名字不存在
 *   - 无权限、计费、限流分别展示，不据此预测发布时间。
 *   - 乱名必须明确返回 1211 才可用作不存在基线。
 */

(() => {
'use strict';

// 智谱开放平台 API（已实测对浏览器开放 CORS，可直连；Key 只在用户浏览器与智谱之间流转）
const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';

const $ = (id) => document.getElementById(id);
const LS = {
  key: 'zp_probe_apikey',
  custom: 'zp_probe_custom',
  builtinSel: 'zp_probe_builtin_sel_v5', // v5：保留版本预览组并恢复用户实测的字面代号组
  results: 'zp_probe_results',
  openList: 'zp_probe_openlist',
  openListTag: 'zp_probe_openlist_keytag',
  calib: 'zp_probe_calib',
};

const CLS_META = {
  open:     { label: '可用',     desc: '返回 200，模型对当前 Key 完全开放' },
  locked:   { label: '无权访问', desc: '当前 Key 被拒访问；无法推断发布时间' },
  billing:  { label: '计费受阻', desc: '余额或资源资格检查未通过；应与已开放的付费模型对照' },
  likely:   { label: '待复核', desc: '接口不匹配信号，尚需同载荷乱名对照' },
  notfound: { label: '不存在',   desc: '与“模型不存在”基线形态一致' },
  unknown:  { label: '无法判定', desc: '限流、网络或其他未识别错误，可重试' },
};

// 现代线性图标（lucide 风格，stroke 跟随文字颜色）
const svgWrap = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  open:     svgWrap('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  locked:   svgWrap('<rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  likely:   svgWrap('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  billing:  svgWrap('<circle cx="12" cy="12" r="10"/><path d="M12 6v12M16 9c-1-1-7-1-7 2s7 1 7 4-6 3-8 1"/>'),
  notfound: svgWrap('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
  unknown:  svgWrap('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  total:    svgWrap('<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'),
  radar:    svgWrap('<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/><circle cx="12" cy="12" r="3"/>'),
  sparkle:  svgWrap('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>'),
};

// ---------------- state ----------------
let apiKey = localStorage.getItem(LS.key) || '';
let customNames = new Set(JSON.parse(localStorage.getItem(LS.custom) || '[]'));
let builtinSelected = JSON.parse(localStorage.getItem(LS.builtinSel) || 'null'); // null = 默认全选
let results = JSON.parse(localStorage.getItem(LS.results) || '{}');
let openModels = new Set(JSON.parse(localStorage.getItem(LS.openList) || '[]'));
let calib = null; // { sig, detail }
let billingControl = null;
let billingControlKey = '';
let activeKeyTag = '';

let running = false;
let shouldStop = false;
let currentFilter = 'all';

// ---------------- utils ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveResults() { localStorage.setItem(LS.results, JSON.stringify(results)); }
function saveCustom() { localStorage.setItem(LS.custom, JSON.stringify([...customNames])); }

function logLine(text) {
  const box = $('logBox');
  const time = new Date().toTimeString().slice(0, 8);
  box.textContent = (box.textContent === '等待操作…' ? '' : box.textContent) + `[${time}] ${text}\n`;
  // 只保留最近 60 行
  const lines = box.textContent.split('\n');
  if (lines.length > 61) box.textContent = lines.slice(-61).join('\n');
  box.scrollTop = box.scrollHeight;
}

function setStatus(el, state, text) {
  el.dataset.state = state;
  el.textContent = text;
}

function parseBody(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// The pure classifier lives in probe-logic.js so recorded responses can be tested offline.
const classify = (model, raw, calibration) => ProbeLogic.classify(model, raw, calibration);

async function keyTag(key) {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((n) => n.toString(16).padStart(2, '0')).join('');
}

function resetControls() {
  calib = null;
  billingControl = null;
  billingControlKey = '';
  $('calibBox').classList.add('hidden');
  openModels = new Set();
  localStorage.removeItem(LS.openList);
  localStorage.removeItem(LS.openListTag);
  localStorage.removeItem(LS.calib);
  $('openModelsBox').classList.add('hidden');
  setStatus($('billingStatus'), 'idle', '尚未校准');
}

// ---------------- 候选名单 ----------------
function getBuiltinSelected() {
  if (builtinSelected) return new Set(builtinSelected);
  const all = [];
  Object.values(CANDIDATE_GROUPS).forEach((arr) => all.push(...arr));
  return new Set(all);
}

function getCandidates() {
  const set = new Set();
  getBuiltinSelected().forEach((n) => set.add(n));
  customNames.forEach((n) => set.add(n));
  return [...set].sort();
}

function sanitizeName(raw) {
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function renderBuiltinGroups() {
  const box = $('builtinGroups');
  box.innerHTML = '';
  const selected = getBuiltinSelected();
  let total = 0, selCount = 0;
  Object.entries(CANDIDATE_GROUPS).forEach(([group, names]) => {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `${group}（${names.length}）`;
    wrap.appendChild(title);
    const chips = document.createElement('div');
    chips.className = 'chips';
    names.forEach((n) => {
      total++;
      const chip = document.createElement('button');
      chip.type = 'button';
      const isSel = selected.has(n);
      if (isSel) selCount++;
      chip.className = 'chip' + (isSel ? ' on' : '');
      chip.textContent = n;
      chip.onclick = () => {
        const cur = getBuiltinSelected();
        if (cur.has(n)) { cur.delete(n); chip.classList.remove('on'); }
        else { cur.add(n); chip.classList.add('on'); }
        builtinSelected = [...cur];
        localStorage.setItem(LS.builtinSel, JSON.stringify(builtinSelected));
        const totalBuiltin = Object.values(CANDIDATE_GROUPS).flat().length;
        $('selAllBuiltin').checked = [...getBuiltinSelected()].length >= totalBuiltin;
        $('builtinCount').textContent = `${[...getBuiltinSelected()].length} / ${totalBuiltin} 已选`;
        updateCandSummary();
      };
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    box.appendChild(wrap);
  });
  $('builtinCount').textContent = `${selCount} / ${total} 已选`;
  $('selAllBuiltin').checked = selCount === total;
}

function renderCustomChips() {
  const box = $('customChips');
  if (!box) return;
  box.innerHTML = '';
  if (customNames.size === 0) {
    box.innerHTML = '<span class="hint">尚未添加自定义候选。</span>';
    return;
  }
  [...customNames].sort().forEach((n) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip on';
    chip.textContent = n + ' ✕';
    chip.title = '点击移除';
    chip.onclick = () => { customNames.delete(n); saveCustom(); renderCustomChips(); updateCandSummary(); };
    box.appendChild(chip);
  });
}

function updateCandSummary() {
  const list = getCandidates();
  $('candSummary').textContent = list.length
    ? `候选名单共 ${list.length} 个：${list.slice(0, 12).join('、')}${list.length > 12 ? ' …' : ''}`
    : '候选名单为空';
}

// ---------------- Key 管理 ----------------
function maskKey(k) {
  if (k.length <= 8) return k.slice(0, 2) + '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

$('saveKeyBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim();
  if (!v) { setStatus($('keyStatus'), 'err', '请先粘贴 Key'); return; }
  if (v !== apiKey) resetControls();
  apiKey = v;
  activeKeyTag = await keyTag(v);
  localStorage.setItem(LS.key, v);
  setStatus($('keyStatus'), 'ok', `已保存（${maskKey(v)}），仅存于本浏览器`);
  logLine(`API Key 已保存（${maskKey(v)}）`);
  renderStats();
  renderResults();
};

$('toggleKeyBtn').onclick = () => {
  const inp = $('apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
};

$('clearKeyBtn').onclick = () => {
  apiKey = '';
  activeKeyTag = '';
  resetControls();
  localStorage.removeItem(LS.key);
  $('apiKeyInput').value = '';
  setStatus($('keyStatus'), 'idle', '已清除');
  renderStats();
  renderResults();
};

$('verifyKeyBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('keyStatus'), 'err', '请先输入 Key'); return; }
  setStatus($('keyStatus'), 'busy', '正在用免费模型验证…');
  try {
    let lastErr = null, okModel = '';
    // 免费模型按序回退：上一代免费模型下线后 Key 验证不会永远报错
    for (const m of FREE_MODELS) {
      const data = await probeOnce(v, m);
      if (data.status === 200) { okModel = m; break; }
      lastErr = data;
    }
    if (okModel) {
      setStatus($('keyStatus'), 'ok', `✅ Key 有效（免费模型 ${okModel} 返回 200）`);
      logLine(`Key 验证通过：${okModel} → 200`);
    } else {
      const body = parseBody(lastErr.body) || {};
      const code = body.error && body.error.code, msg = body.error && body.error.message;
      if (lastErr.status === 401 || code === '1000' || code === '1001') {
        setStatus($('keyStatus'), 'err', `❌ Key 无效（HTTP ${lastErr.status} ${code || ''} ${msg || ''}）`);
      } else {
        setStatus($('keyStatus'), 'warn', `⚠️ Key 已发出请求但免费模型均返回 ${lastErr.status}（${code || ''} ${msg || ''}）——可继续尝试嗅探`);
      }
      logLine(`Key 验证：HTTP ${lastErr.status} code=${code || '-'} msg=${msg || '-'}`);
    }
  } catch (e) {
    setStatus($('keyStatus'), 'err', `验证请求失败：${e.message}`);
  }
};

// ---------------- 官方模型列表 ----------------
$('fetchModelsBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('baselineStatus'), 'err', '请先输入并保存 Key'); return; }
  setStatus($('baselineStatus'), 'busy', '正在拉取官方模型列表…');
  try {
    let data;
    try {
      const started = Date.now();
      const r = await fetch(`${ZHIPU_BASE}/models`, { headers: { Authorization: `Bearer ${v}` } });
      data = { status: r.status, body: await r.text(), latencyMs: Date.now() - started };
    } catch (e) {
      setStatus($('baselineStatus'), 'err', `拉取失败：网络错误 ${e.message}`);
      return;
    }
    if (data.status !== 200) {
      const body = parseBody(data.body) || {};
      setStatus($('baselineStatus'), 'err', `HTTP ${data.status}：${(body.error && body.error.message) || data.body.slice(0, 120)}`);
      return;
    }
    const body = parseBody(data.body) || {};
    let names = [];
    const list = body.data || body.models || [];
    if (Array.isArray(list)) {
      names = list.map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean);
    }
    // 反向 diff：官方列表出现了内置 SEED 与上次快照都没有的名字 → 词典陈旧告警。
    // 必须在下方覆盖 LS.openList 之前计算，否则 known 集合永远包含本次结果，diff 恒为空
    const known = new Set([
      ...Object.values(OPEN_MODELS_SEED).flat(),
      ...(JSON.parse(localStorage.getItem(LS.openList) || '[]')),
    ]);
    const fresh = names.map((n) => String(n).toLowerCase()).filter((n) => !known.has(n));
    if (fresh.length > 0) {
      logLine(`官方列表新增 ${fresh.length} 个内置词典未收录：${fresh.join('、')}——建议人工确认后更新 OPEN_MODELS_SEED 并从候选剔除`);
      $('openDiffBox').classList.remove('hidden');
      const diffChips = $('openDiffChips');
      diffChips.innerHTML = '';
      fresh.forEach((n) => {
        const chip = document.createElement('span');
        chip.className = 'chip fresh';
        chip.textContent = n;
        chip.title = '官方 /models 已返回该名字，但内置 OPEN_MODELS_SEED 未收录——以拉取结果为准';
        diffChips.appendChild(chip);
      });
    } else {
      $('openDiffBox').classList.add('hidden');
    }
    openModels = new Set(names.map((n) => String(n).toLowerCase()));
    localStorage.setItem(LS.openList, JSON.stringify([...openModels]));
    localStorage.setItem(LS.openListTag, await keyTag(v));
    $('openModelsBox').classList.remove('hidden');
    $('openModelsCount').textContent = openModels.size;
    const chipsBox = $('openModelsChips');
    chipsBox.innerHTML = '';
    [...openModels].sort().forEach((n) => {
      const chip = document.createElement('span');
      chip.className = 'chip static';
      chip.textContent = n;
      chipsBox.appendChild(chip);
    });
    setStatus($('baselineStatus'), 'ok', `✅ 列表返回 ${openModels.size} 个模型；不代表它们均可调用`);
    logLine(`官方模型列表：${openModels.size} 个`);
  } catch (e) {
    setStatus($('baselineStatus'), 'err', `拉取失败：${e.message}`);
  }
};

// ---------------- 对照校准 ----------------
async function calibrate(v) {
  setStatus($('baselineStatus'), 'busy', '校准中：发送随机乱名…');
  const rand = 'probe-nonexist-' + Math.random().toString(36).slice(2, 10);
  try {
    const data = await probeOnce(v, rand);
    const err = ProbeLogic.errorOf(data);
    if (!ProbeLogic.isMissing(data) || err.code !== '1211') {
      calib = null;
      localStorage.removeItem(LS.calib);
      $('calibBox').classList.add('hidden');
      setStatus($('baselineStatus'), 'err', `校准失败：乱名得到 HTTP ${data.status} / ${err.code || '-'}；只有 1211 才能作不存在基线`);
      logLine(`校准拒绝：${rand} → HTTP ${data.status} code=${err.code || '-'} ${err.message}`);
      return false;
    }
    calib = { valid: true, sig: ProbeLogic.signature(data), model: rand, ts: Date.now(), detail: `HTTP ${data.status} · code=${err.code} · msg=${err.message}` };
    localStorage.setItem(LS.calib, JSON.stringify({ ...calib, keyTag: await keyTag(v) }));
    $('calibBox').classList.remove('hidden');
    $('calibDetail').textContent = `测试乱名：${rand}\n形态签名：${calib.sig}\n原始响应：${data.body.slice(0, 300)}`;
    setStatus($('baselineStatus'), 'ok', `✅ 校准完成：形态签名 ${calib.sig}（嗅探结果将与此比对）`);
    logLine(`校准完成：乱名 ${rand} → ${calib.detail}`);
    return true;
  } catch (e) {
    setStatus($('baselineStatus'), 'err', `校准失败：${e.message}`);
    return false;
  }
};

$('calibrateBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('baselineStatus'), 'err', '请先输入 Key'); return; }
  await calibrate(v);
};

$('billingBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('billingStatus'), 'err', '请先输入 Key'); return; }
  setStatus($('billingStatus'), 'busy', '正在用已开放的付费模型 glm-5.3 检查该 Key 的支付能力…');
  const raw = await probeOnce(v, 'glm-5.3');
  const err = ProbeLogic.errorOf(raw);
  billingControl = { model: 'glm-5.3', status: raw.status, code: err.code, msg: err.message, ts: Date.now() };
  billingControlKey = v;
  const state = raw.status === 200 ? 'ok' : ProbeLogic.isBilling(raw) ? 'warn' : 'err';
  const meaning = raw.status === 200 ? '可支付本次对照请求' : ProbeLogic.isBilling(raw) ? '计费或资源资格受阻' : '无法判定支付能力';
  setStatus($('billingStatus'), state, `${meaning} · HTTP ${raw.status} / ${err.code || '-'}`);
  logLine(`计费对照 glm-5.3 → HTTP ${raw.status} code=${err.code || '-'} ${err.message}`);
};

// ---------------- 免 Key 旁路通道 ----------------
// ① HuggingFace zai-org 新仓库监控：HF API 对页面 Origin 返回 ACAO（实测），浏览器可直读；
//    新开源仓库与 API 发布接近同步（GLM-5.3 系 2026-08-25 建仓），新 repo 出现即强存在性旁证
$('hfWatchBtn').onclick = async () => {
  setStatus($('hfStatus'), 'busy', '正在扫描 HuggingFace zai-org 新仓库…');
  try {
    const r = await fetch('https://huggingface.co/api/models?author=zai-org&sort=createdAt&direction=-1&limit=50');
    if (!r.ok) {
      setStatus($('hfStatus'), 'err', `HuggingFace API 返回 HTTP ${r.status}（接口变更或网络受限）`);
      return;
    }
    const list = await r.json();
    if (!Array.isArray(list) || list.length === 0) {
      setStatus($('hfStatus'), 'warn', 'zai-org 名下未扫描到公开仓库');
      return;
    }
    const chipsBox = $('hfModelsChips');
    chipsBox.innerHTML = '';
    const now = Date.now();
    let recent = 0;
    list.slice(0, 20).forEach((m) => {
      const repo = String(m.id || '');
      const created = m.createdAt ? String(m.createdAt).slice(0, 10) : '未知';
      const pt = m.pipelineTag ? ` · ${m.pipelineTag}` : '';
      // 仓库 id → 可试 API 调用名：GLM-5.3-Flash-BF16 → glm-5.3-flash-bf16（去掉 -bf16 即候选线索）
      const apiName = repo.replace(/^zai-org\//, '').toLowerCase();
      const fresh30 = Boolean(m.createdAt) && (now - Date.parse(m.createdAt) <= 30 * 24 * 3600 * 1000);
      const chip = document.createElement('span');
      chip.className = 'chip static' + (fresh30 ? ' fresh' : '');
      chip.textContent = repo.replace(/^zai-org\//, '');
      chip.title = `创建时间：${created}${pt}\n可试 API 名：${apiName}`;
      chipsBox.appendChild(chip);
      if (fresh30) {
        recent++;
        logLine(`🆕 HF 新仓库（30 天内）：${repo}（${created}）→ 可试 API 名 ${apiName}${/-bf16$/.test(apiName) ? '（去掉 -bf16 即候选线索）' : ''}，可加入自定义候选`);
      }
    });
    $('hfModelsBox').classList.remove('hidden');
    setStatus($('hfStatus'), 'ok', `✅ 扫描到 ${list.length} 个仓库（展示最近 ${Math.min(list.length, 20)} 个），近 30 天新增 ${recent} 个`);
    logLine(`HF zai-org 扫描完成：共 ${list.length} 个仓库，近 30 天新增 ${recent} 个${recent === 0 ? '（新 repo 出现即强信号，建议定期回扫）' : ''}`);
  } catch (e) {
    setStatus($('hfStatus'), 'err', `扫描失败：${e.message}`);
  }
};

// ② 文档页探测脚本导出：docs.bigmodel.cn 文档页 404/200 是免 Key 存在性信号，
//    但浏览器直连被 CORS 拦截（实测 200/404 页均不返回 ACAO），故导出本机 curl 脚本保真执行；
//    不经 r.jina.ai 中转（实测限流返回 401、SPA 壳返回 200，信号失真）
$('exportDocsProbeBtn').onclick = () => {
  const names = getCandidates();
  if (!names.length) { alert('候选名单为空：请先勾选内置词典或添加自定义/生成候选'); return; }
  const header =
    '#!/usr/bin/env bash\n' +
    '# 智谱文档页探测脚本（由嗅探站导出，在本机运行，免 API Key）\n' +
    '# 原理：HTTP 200=文档页已上线（新模型页先于/伴随 API 发布），404=无页面；\n' +
    '#       另可 diff https://docs.bigmodel.cn/llms.txt 捕捉全站新页。\n' +
    '# 用法：bash probe-docs.sh\n';
  const lines = names.map((n) =>
    `printf '%-28s text:%s vlm:%s\\n' ${n} \\\n` +
    `  "$(curl -s -o /dev/null -w '%{http_code}' https://docs.bigmodel.cn/cn/guide/models/text/${n}.md)" "$(curl -s -o /dev/null -w '%{http_code}' https://docs.bigmodel.cn/cn/guide/models/vlm/${n}.md)"`);
  download(new Blob([header + lines.join('\n') + '\n'], { type: 'text/x-shellscript' }), 'probe-docs.sh');
  logLine(`已导出文档页探测脚本 probe-docs.sh（覆盖 ${names.length} 个候选 × text/vlm 两类页面，本机 bash 运行）`);
};

// ---------------- 嗅探引擎 ----------------
/* 直连智谱：max_tokens=1 最小化消耗。返回与旧代理版一致的 {status, body, latencyMs} 形态，
 * classify() 无需感知差异；网络异常归一化为 status 0。 */
async function probeOnce(key, model, messages = [{ role: 'user', content: 'hi' }]) {
  const started = Date.now();
  try {
    const r = await fetch(`${ZHIPU_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: 1, stream: false }),
    });
    return { status: r.status, body: await r.text(), latencyMs: Date.now() - started };
  } catch (e) {
    return {
      status: 0,
      body: JSON.stringify({ error: { code: 'network', message: String((e && e.message) || e) } }),
      latencyMs: Date.now() - started,
    };
  }
}

$('startBtn').onclick = async () => {
  if (running) return;
  const key = $('apiKeyInput').value.trim() || apiKey;
  if (!key) { alert('请先在第①步输入并保存 API Key'); return; }
  const fingerprint = await keyTag(key);
  activeKeyTag = fingerprint;
  renderStats();
  renderResults();
  let candidates = getCandidates();
  if (candidates.length === 0) { alert('候选名单为空：请至少勾选内置词典里的名字，或添加自定义/生成候选'); return; }
  if ($('skipOpen').checked && openModels.size > 0 && localStorage.getItem(LS.openListTag) === fingerprint) {
    const before = candidates.length;
    candidates = candidates.filter((n) => !openModels.has(n));
    const skipped = before - candidates.length;
    if (skipped > 0) logLine(`已跳过 ${skipped} 个官方列表返回的名称`);
  }
  running = true;
  shouldStop = false;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  $('progressWrap').classList.remove('hidden');

  const ok = await calibrate(key);
  if (!ok) {
    running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    logLine('已停止：不存在基线尚未验证，避免把账号或网络错误误判为模型信号');
    return;
  }
  const runCalibration = { ...calib };
  const billingSnapshot = billingControlKey === key && billingControl && Date.now() - billingControl.ts < 10 * 60 * 1000 ? billingControl : null;

  const total = candidates.length;
  let done = 0;
  const queue = [...candidates];
  const conc = Number($('concurrency').value);
  const gap = Number($('intervalMs').value);

  const worker = async (wid) => {
    while (!shouldStop && queue.length > 0) {
      const model = queue.shift();
      if (!model) break;
      try {
        let raw = await probeOnce(key, model);
        // 1113 也可能使用 HTTP 429；它是计费错误，不能当限流重试。
        if (ProbeLogic.shouldRetry(raw) && !shouldStop) {
          await sleep(1500);
          raw = await probeOnce(key, model);
        }
        const item = classify(model, raw, runCalibration);
        item.keyTag = fingerprint;
        item.endpoint = `${ZHIPU_BASE}/chat/completions`;
        item.payload = 'hi / max_tokens:1 / stream:false';
        item.calibration = { sig: runCalibration.sig, ts: runCalibration.ts };
        if (billingSnapshot) item.billingControl = billingSnapshot;
        const recordKey = `${fingerprint}|${model}`;
        item.recordKey = recordKey;
        const prev = results[recordKey];
        const comparable = prev && prev.keyTag === fingerprint && prev.endpoint === item.endpoint && prev.payload === item.payload;
        item.history = comparable ? [...(prev.history || []), {
          cls: prev.cls, status: prev.status, code: prev.code, ts: prev.ts, rawBody: prev.rawBody,
        }].slice(-10) : [];
        if (comparable && (prev.cls !== item.cls || prev.code !== item.code || prev.status !== item.status)) {
          item.change = `${prev.status}/${prev.code || '-'} → ${item.status}/${item.code || '-'}`;
          logLine(`状态变化 ${model}：${item.change}（同一 Key 指纹与请求配置）`);
        }
        if (item.keyInvalid) {
          shouldStop = true;
          setStatus($('keyStatus'), 'err', '❌ Key 无效（身份验证失败），嗅探已停止');
          logLine(`Key 无效，终止全部嗅探：${model} → ${item.code} ${item.msg}`);
        }
        results[recordKey] = item;
        logLine(`${model} → HTTP ${item.status} code=${item.code || '-'} [${CLS_META[item.cls].label}] ${item.msg || item.note || ''} ${item.latencyMs}ms`);
      } catch (e) {
        results[`${fingerprint}|${model}`] = { model, keyTag: fingerprint, recordKey: `${fingerprint}|${model}`, cls: 'unknown', status: -1, code: '', msg: String(e.message || e), latencyMs: 0, ts: Date.now(), sig: '' };
        logLine(`${model} → 请求异常：${e.message}`);
      }
      done++;
      $('progressBar').style.width = `${(done / total) * 100}%`;
      $('progressText').textContent = `${done} / ${total}`;
      saveResults();
      renderStats();
      renderResults();
      if (queue.length > 0 && !shouldStop) await sleep(gap);
    }
  };

  // 无论 worker 是否异常，收尾必须执行，否则按钮会永久卡在禁用态
  try {
    await Promise.all(Array.from({ length: conc }, (_, i) => worker(i)));
  } catch (e) {
    logLine(`嗅探引擎异常：${e.message || e}`);
  } finally {
    running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    const found = visibleResults().filter((r) => r.cls === 'locked').length;
    logLine(`嗅探结束：本次共处理 ${done} 个，无权访问 ${found} 个`);
  }
};

$('stopBtn').onclick = () => {
  shouldStop = true;
  logLine('已请求停止，等待在途请求完成…');
};

// ---------------- 结果渲染 ----------------
function visibleResults() {
  return activeKeyTag ? Object.values(results).filter((r) => r.keyTag === activeKeyTag) : [];
}

function renderStats() {
  const c = { open: 0, locked: 0, billing: 0, likely: 0, notfound: 0, unknown: 0 };
  visibleResults().forEach((r) => { if (c[r.cls] != null) c[r.cls]++; });
  $('statOpen').textContent = c.open;
  $('statLocked').textContent = c.locked;
  $('statBilling').textContent = c.billing;
  $('statLikely').textContent = c.likely;
  $('statNotFound').textContent = c.notfound;
  $('statUnknown').textContent = c.unknown;
  $('statTotal').textContent = visibleResults().length;
}

const ORDER = { locked: 0, billing: 1, likely: 2, open: 3, unknown: 4, notfound: 5 };

function renderResults() {
  const box = $('resultList');
  const items = visibleResults()
    .filter((r) => currentFilter === 'all' || r.cls === currentFilter)
    .sort((a, b) => (ORDER[a.cls] - ORDER[b.cls]) || a.model.localeCompare(b.model));
  box.innerHTML = '';
  if (!items.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    const text = currentFilter === 'all'
      ? '尚无结果 —— 配置好 Key 与候选名单后点「开始嗅探」'
      : '该分类下暂无结果';
    d.innerHTML = `<span class="empty-ic">${ICONS.radar}</span><span>${text}</span>`;
    box.appendChild(d);
    return;
  }
  items.forEach((r) => {
    const meta = CLS_META[r.cls] || CLS_META.unknown;
    const card = document.createElement('div');
    card.className = `result r-${r.cls}`;

    // 图标块
    const tile = document.createElement('div');
    tile.className = 'r-tile';
    tile.innerHTML = ICONS[r.cls] || ICONS.unknown;
    tile.title = meta.desc;
    card.appendChild(tile);

    // 主体
    const body = document.createElement('div');
    body.className = 'r-body';

    const head = document.createElement('div');
    head.className = 'r-head';
    const name = document.createElement('span');
    name.className = 'r-name';
    name.textContent = r.model;
    head.appendChild(name);
    const badge = document.createElement('span');
    badge.className = `badge b-${r.cls}`;
    badge.textContent = meta.label;
    head.appendChild(badge);
    body.appendChild(head);

    const chips = document.createElement('div');
    chips.className = 'r-chips';
    chips.innerHTML =
      `<span class="pchip">HTTP ${r.status}</span>` +
      `<span class="pchip">code ${r.code || '-'}</span>` +
      `<span class="pchip">${r.latencyMs} ms</span>`;
    body.appendChild(chips);

    const msg = document.createElement('div');
    msg.className = 'r-msg';
    msg.textContent = r.note ? `${r.note} · ${r.msg || '-'}` : (r.msg || '-');
    body.appendChild(msg);

    if (r.change) {
      const change = document.createElement('div');
      change.className = 'r-change';
      change.textContent = `同一 Key 的上次响应：${r.change}`;
      body.appendChild(change);
    }
    if (r.emptyControl) {
      const proof = document.createElement('div');
      proof.className = 'r-proof';
      proof.textContent = `空消息对照：${r.emptyControl.note}（候选 ${r.emptyControl.candidate.status}/${r.emptyControl.candidate.code || '-'}，乱名 ${r.emptyControl.missing.status}/${r.emptyControl.missing.code || '-'}）`;
      body.appendChild(proof);
    }
    if (r.keyTag) {
      const action = document.createElement('button');
      action.className = 'btn ghost probe-detail';
      action.textContent = '空消息对照';
      action.title = '对该候选与随机乱名发送相同的空消息请求，比较 1214 与 1211；额外发送 2 次请求';
      action.onclick = async () => {
        const key = $('apiKeyInput').value.trim() || apiKey;
        if (!key || await keyTag(key) !== r.keyTag) {
          logLine(`空消息对照取消：${r.model} 的历史结果与当前 Key 不同，请先重新扫描`);
          return;
        }
        action.disabled = true;
        action.textContent = '对照中…';
        const randomName = 'probe-nonexist-' + Math.random().toString(36).slice(2, 10);
        const [candidateRaw, missingRaw] = await Promise.all([
          probeOnce(key, r.model, []), probeOnce(key, randomName, []),
        ]);
        const verdict = ProbeLogic.compareEmptyControl(candidateRaw, missingRaw);
        const current = results[r.recordKey];
        if (current && current.ts === r.ts) {
          current.emptyControl = {
            ...verdict,
            candidate: { status: candidateRaw.status, code: ProbeLogic.errorOf(candidateRaw).code, body: candidateRaw.body.slice(0, 1000) },
            missing: { model: randomName, status: missingRaw.status, code: ProbeLogic.errorOf(missingRaw).code, body: missingRaw.body.slice(0, 1000) },
            ts: Date.now(),
          };
          saveResults();
          renderResults();
        }
        logLine(`${r.model} 空消息对照：${verdict.note}`);
      };
      body.appendChild(action);
    }

    card.appendChild(body);
    box.appendChild(card);
  });
}

document.querySelectorAll('#filters .filter').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('#filters .filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.f;
    renderResults();
  };
});

// ---------------- 导出 ----------------
$('exportJsonBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ generated_at: new Date().toISOString(), calibrated: calib, results }, null, 2)], { type: 'application/json' });
  download(blob, `zhipu-probe-${Date.now()}.json`);
};
$('exportCsvBtn').onclick = () => {
  const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const rows = [['model', 'class', 'http_status', 'code', 'message', 'note', 'latency_ms', 'probed_at', 'key_tag', 'endpoint', 'change', 'empty_control_verdict', 'billing_control_code']];
  Object.values(results).forEach((r) => rows.push([r.model, r.cls, r.status, r.code, r.msg, r.note || '', r.latencyMs, new Date(r.ts).toISOString(), r.keyTag || '', r.endpoint || '', r.change || '', r.emptyControl?.verdict || '', r.billingControl?.code || '']));
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `zhipu-probe-${Date.now()}.csv`);
};
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('clearResultsBtn').onclick = () => {
  if (!confirm('确认清空全部嗅探结果？')) return;
  results = {};
  saveResults();
  renderStats();
  renderResults();
  logLine('已清空结果');
};

// ---------------- 生成器 ----------------
function renderGenSuffixes() {
  const box = $('genSuffixes');
  box.innerHTML = '';
  GEN_SUFFIX_OPTIONS.forEach((s) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (s === '' || s === '-flash' || s === '-air' || s === '-preview' ? ' on' : '');
    chip.textContent = s === '' ? '（无后缀）' : s;
    chip.onclick = () => chip.classList.toggle('on');
    chip.dataset.suffix = s;
    box.appendChild(chip);
  });
}

function genCombos() {
  const bases = $('genBase').value.split(/[,\s，、]+/).map(sanitizeName).filter(Boolean);
  const suffixes = [...document.querySelectorAll('#genSuffixes .chip.on')].map((c) => c.dataset.suffix);
  const out = new Set();
  bases.forEach((b) => suffixes.forEach((s) => out.add(sanitizeName(b + s))));
  return [...out].filter(Boolean).sort();
}

$('genPreviewBtn').onclick = () => {
  const combos = genCombos();
  const box = $('genPreview');
  box.classList.remove('hidden');
  box.textContent = combos.length ? `将生成 ${combos.length} 个候选：\n${combos.join('、')}` : '（无组合：请检查基础名与后缀）';
};

$('genApplyBtn').onclick = () => {
  const combos = genCombos();
  if (!combos.length) { alert('无组合可添加'); return; }
  combos.forEach((n) => customNames.add(n));
  saveCustom();
  renderCustomChips();
  updateCandSummary();
  logLine(`生成器并入 ${combos.length} 个候选`);
};

// ---------------- 自定义名单 ----------------
$('applyCustomBtn').onclick = () => {
  const lines = $('customInput').value.split(/\n+/).map(sanitizeName).filter(Boolean);
  if (!lines.length) { alert('请先在文本框中输入模型名'); return; }
  const before = customNames.size;
  lines.forEach((n) => customNames.add(n));
  saveCustom();
  renderCustomChips();
  updateCandSummary();
  logLine(`自定义并入 ${customNames.size - before} 个新候选（解析 ${lines.length} 行）`);
};
$('clearCustomBtn').onclick = () => {
  customNames = new Set();
  saveCustom();
  renderCustomChips();
  updateCandSummary();
};

// ---------------- tabs ----------------
document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    $(`pane-${tab.dataset.tab}`).classList.add('active');
  };
});

$('selAllBuiltin').onchange = (e) => {
  const all = [];
  Object.values(CANDIDATE_GROUPS).forEach((arr) => all.push(...arr));
  builtinSelected = e.target.checked ? all : [];
  localStorage.setItem(LS.builtinSel, JSON.stringify(builtinSelected));
  renderBuiltinGroups();
  updateCandSummary();
};

// ---------------- init ----------------
async function init() {
  // 纯静态版：无本地服务依赖，浏览器直连智谱（平台已开放 CORS）
  $('connDot').className = 'dot ok';
  $('connText').textContent = '纯静态版 · 浏览器直连智谱';

  // 注入 SVG 图标（统计卡 / 过滤器 / 提示行）
  document.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = ICONS[el.dataset.ic] || ''; });
  document.querySelectorAll('#filters .filter').forEach((b) => {
    const ic = ICONS[b.dataset.f] || ICONS.radar;
    b.insertAdjacentHTML('afterbegin', `<span class="fic">${ic}</span>`);
  });
  if (apiKey) {
    activeKeyTag = await keyTag(apiKey);
    $('apiKeyInput').value = apiKey;
    setStatus($('keyStatus'), 'ok', `已载入保存的 Key（${maskKey(apiKey)}）`);
  }
  // 恢复自定义 chips 区
  const pane = $('pane-custom');
  const chipsWrap = document.createElement('div');
  chipsWrap.id = 'customChips';
  chipsWrap.className = 'chips';
  pane.insertBefore(chipsWrap, pane.querySelector('.row-btns'));
  renderBuiltinGroups();
  renderCustomChips();
  renderGenSuffixes();
  updateCandSummary();
  renderStats();
  renderResults();
  if (openModels.size > 0 && apiKey && localStorage.getItem(LS.openListTag) === await keyTag(apiKey)) {
    $('openModelsBox').classList.remove('hidden');
    $('openModelsCount').textContent = openModels.size;
    const chipsBox = $('openModelsChips');
    chipsBox.innerHTML = '';
    [...openModels].sort().forEach((n) => {
      const chip = document.createElement('span');
      chip.className = 'chip static';
      chip.textContent = n;
      chipsBox.appendChild(chip);
    });
    setStatus($('baselineStatus'), 'ok', `已载入历史列表中的 ${openModels.size} 个名称`);
  } else {
    openModels = new Set();
  }
  // 历史校准仅用于展示；每轮扫描仍用当前 Key 重新校准。
  const savedCalib = JSON.parse(localStorage.getItem(LS.calib) || 'null');
  if (savedCalib && savedCalib.sig && savedCalib.keyTag === activeKeyTag) {
    $('calibBox').classList.remove('hidden');
    $('calibDetail').textContent =
      `（${savedCalib.ts ? new Date(savedCalib.ts).toLocaleString() : '时间未知'} 的历史校准，每轮扫描会重验）\n形态签名：${savedCalib.sig}\n详情：${savedCalib.detail || '-'}`;
    if (savedCalib.ts && Date.now() - savedCalib.ts > 24 * 60 * 60 * 1000) {
      logLine('基线已过期（超过 24 小时），建议重新校准');
    } else {
      logLine(`已载入历史校准记录：${savedCalib.sig}；扫描时将重新验证`);
    }
  }
  logLine('页面就绪。建议流程：保存 Key → 拉取官方列表 → 校准 → 开始嗅探');
}

init();
})();
