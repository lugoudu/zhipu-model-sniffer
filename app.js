/* 智谱模型嗅探站 —— 前端逻辑（无框架，原生 JS）
 *
 * 嗅探原理：
 *   对每个候选模型名发送一次 max_tokens=1 的 chat 请求，根据响应差异分类：
 *   - HTTP 200                    → 已开放可用
 *   - “模型不存在”类错误          → 名字不存在
 *   - “无权访问 / 需申请”类错误    → 🔥 模型存在但未对你开放（疑似即将发布或内测）
 *   - “不支持该接口 / 计费 / 参数”类错误 → 大概率存在（模型名校验已通过）
 *   分类器自适应：开始嗅探前先用随机乱名做“不存在基线校准”，
 *   任何结果若与基线形态完全一致则强制归为不存在，避免误报。
 */

(() => {
'use strict';

// 智谱开放平台 API（已实测对浏览器开放 CORS，可直连；Key 只在用户浏览器与智谱之间流转）
const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';

const $ = (id) => document.getElementById(id);
const LS = {
  key: 'zp_probe_apikey',
  custom: 'zp_probe_custom',
  builtinSel: 'zp_probe_builtin_sel',
  results: 'zp_probe_results',
  openList: 'zp_probe_openlist',
};

const CLS_META = {
  open:     { label: '已开放',   icon: '🟢', desc: '返回 200，模型对当前 Key 完全开放' },
  locked:   { label: '存在·无权', icon: '🔥', desc: '模型名通过了存在性校验但被拒：疑似未开放/内测/即将发布' },
  likely:   { label: '疑似存在', icon: '⚡', desc: '报错类型出现在模型校验之后（接口不匹配/计费/参数），大概率存在' },
  notfound: { label: '不存在',   icon: '🚫', desc: '与“模型不存在”基线形态一致' },
  unknown:  { label: '无法判定', icon: '🌫', desc: '限流、网络或其他未识别错误，可重试' },
};

// ---------------- state ----------------
let apiKey = localStorage.getItem(LS.key) || '';
let customNames = new Set(JSON.parse(localStorage.getItem(LS.custom) || '[]'));
let builtinSelected = JSON.parse(localStorage.getItem(LS.builtinSel) || 'null'); // null = 默认全选
let results = JSON.parse(localStorage.getItem(LS.results) || '{}');
let openModels = new Set(JSON.parse(localStorage.getItem(LS.openList) || '[]'));
let calib = null; // { sig, detail }

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

function formSignature(status, body) {
  const err = body && body.error;
  const code = err && err.code != null ? String(err.code) : '';
  return `${status}|${code}`;
}

// ---------------- 分类器 ----------------
function classify(model, raw) {
  const body = parseBody(raw.body);
  const err = (body && body.error) || {};
  const code = err.code != null ? String(err.code) : '';
  const msg = err.message ? String(err.message) : '';
  const text = `${code} ${msg}`.toLowerCase();

  const base = { model, status: raw.status, code, msg, latencyMs: raw.latencyMs, ts: Date.now(), sig: formSignature(raw.status, body) };

  if (raw.status === 200) return { ...base, cls: 'open' };

  if (raw.status === 0 || code === 'network')
    return { ...base, cls: 'unknown', note: '网络错误或超时' };

  // 任何 401 都是认证问题（实测有多种文案：1000 身份验证失败 / token expired or incorrect），
  // 不携带模型存在性信号，一律判定 Key 无效
  if (raw.status === 401 || code === '1000' || code === '1001')
    return { ...base, cls: 'unknown', note: 'KEY_INVALID', keyInvalid: true };

  // 校准比对：与“乱名基线”形态完全一致 → 不存在
  if (calib && base.sig === calib.sig)
    return { ...base, cls: 'notfound', note: '与不存在基线形态一致' };

  // 不存在类
  if (code === '1211' || /不存在|没有找到|找不到|not\s*found|does\s*not\s*exist|no\s*such\s*model|invalid\s*model/.test(text))
    return { ...base, cls: 'notfound' };

  // 无权访问类 → 最高价值（1220 为实测确认的真实错误码：“您无权访问xxx”）
  if (code === '1213' || code === '1220' || raw.status === 403 || /无权|权限|许可|未授权|申请开通|订阅|permission|not\s*authorized|access\s*denied|forbidden/.test(text))
    return { ...base, cls: 'locked' };

  // 接口不匹配类（如对向量/图像/语音模型调 chat）→ 模型存在
  if (/不支持|暂不支持|not\s*support|unsupported|错误的接口|不适用于|仅支持|该方法/.test(text))
    return { ...base, cls: 'likely', note: '该名称通过了存在性校验，但不支持对话接口（多为向量/图像/语音类模型）' };

  // 计费/配额类：若平台在模型校验之后才计费，则说明模型存在
  if (/余额|欠费|balance|arrears|1113/.test(text))
    return { ...base, cls: 'likely', note: '报错发生在计费/配额环节；若平台先校验模型后计费，则说明模型存在（请人工复核）' };

  // 限流类 → 无法判定，值得重试
  if (raw.status === 429 || code === '1302' || /限流|频繁|rate\s*limit|too\s*many/.test(text))
    return { ...base, cls: 'unknown', note: '触发限流，建议稍后重试' };

  // 参数类：模型名可能已通过校验，但顺序未知
  if (raw.status === 400 || /参数|param|invalid\s*request|messages|上下文|context\s*length/.test(text))
    return { ...base, cls: 'likely', note: '参数校验类错误：若平台先校验模型名再校验参数，则模型存在（请人工复核）' };

  return { ...base, cls: 'unknown' };
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

$('saveKeyBtn').onclick = () => {
  const v = $('apiKeyInput').value.trim();
  if (!v) { setStatus($('keyStatus'), 'err', '请先粘贴 Key'); return; }
  apiKey = v;
  localStorage.setItem(LS.key, v);
  setStatus($('keyStatus'), 'ok', `已保存（${maskKey(v)}），仅存于本浏览器`);
  logLine(`API Key 已保存（${maskKey(v)}）`);
};

$('toggleKeyBtn').onclick = () => {
  const inp = $('apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
};

$('clearKeyBtn').onclick = () => {
  apiKey = '';
  localStorage.removeItem(LS.key);
  $('apiKeyInput').value = '';
  setStatus($('keyStatus'), 'idle', '已清除');
};

$('verifyKeyBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('keyStatus'), 'err', '请先输入 Key'); return; }
  setStatus($('keyStatus'), 'busy', '正在用免费模型验证…');
  try {
    const data = await probeOnce(v, FREE_MODEL);
    if (data.status === 200) {
      setStatus($('keyStatus'), 'ok', `✅ Key 有效（免费模型 ${FREE_MODEL} 返回 200）`);
      logLine(`Key 验证通过：${FREE_MODEL} → 200`);
    } else {
      const body = parseBody(data.body) || {};
      const code = body.error && body.error.code, msg = body.error && body.error.message;
      if (data.status === 401 || code === '1000' || code === '1001') {
        setStatus($('keyStatus'), 'err', `❌ Key 无效（HTTP ${data.status} ${code || ''} ${msg || ''}）`);
      } else {
        setStatus($('keyStatus'), 'warn', `⚠️ Key 已发出请求但返回 ${data.status}（${code || ''} ${msg || ''}）——可继续尝试嗅探`);
      }
      logLine(`Key 验证：HTTP ${data.status} code=${code || '-'} msg=${msg || '-'}`);
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
    openModels = new Set(names.map((n) => String(n).toLowerCase()));
    localStorage.setItem(LS.openList, JSON.stringify([...openModels]));
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
    setStatus($('baselineStatus'), 'ok', `✅ 已拉取 ${openModels.size} 个官方模型（作为已开放对照）`);
    logLine(`官方模型列表：${openModels.size} 个`);
  } catch (e) {
    setStatus($('baselineStatus'), 'err', `拉取失败：${e.message}`);
  }
};

// ---------------- 校准 ----------------
$('calibrateBtn').onclick = async () => {
  const v = $('apiKeyInput').value.trim() || apiKey;
  if (!v) { setStatus($('baselineStatus'), 'err', '请先输入并保存 Key'); return; }
  setStatus($('baselineStatus'), 'busy', '校准中：发送随机乱名…');
  const rand = 'probe-nonexist-' + Math.random().toString(36).slice(2, 10);
  try {
    const data = await probeOnce(v, rand);
    const body = parseBody(data.body) || {};
    const err = body.error || {};
    const eCode = err.code != null ? String(err.code) : '';
    // 认证类错误不能作为“模型不存在”基线，否则会把后续所有同错误形态的结果误判为不存在
    if (data.status === 401 || eCode === '1000' || eCode === '1001') {
      setStatus($('baselineStatus'), 'err', `❌ 无法校准：Key 无效（HTTP ${data.status} ${eCode} ${err.message || ''}），请先检查 Key`);
      logLine(`校准中止：乱名请求返回认证错误 ${eCode}`);
      return;
    }
    calib = { sig: formSignature(data.status, body), detail: `HTTP ${data.status} · code=${err.code != null ? err.code : '-'} · msg=${err.message || '-'}` };
    $('calibBox').classList.remove('hidden');
    $('calibDetail').textContent = `测试乱名：${rand}\n形态签名：${calib.sig}\n原始响应：${data.body.slice(0, 300)}`;
    setStatus($('baselineStatus'), 'ok', `✅ 校准完成：形态签名 ${calib.sig}（嗅探结果将与此比对）`);
    logLine(`校准完成：乱名 ${rand} → ${calib.detail}`);
  } catch (e) {
    setStatus($('baselineStatus'), 'err', `校准失败：${e.message}`);
  }
};

// ---------------- 嗅探引擎 ----------------
/* 直连智谱：max_tokens=1 最小化消耗。返回与旧代理版一致的 {status, body, latencyMs} 形态，
 * classify() 无需感知差异；网络异常归一化为 status 0。 */
async function probeOnce(key, model) {
  const started = Date.now();
  try {
    const r = await fetch(`${ZHIPU_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
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
  let candidates = getCandidates();
  if (candidates.length === 0) { alert('候选名单为空：请至少勾选内置词典里的名字，或添加自定义/生成候选'); return; }
  if ($('skipOpen').checked && openModels.size > 0) {
    const before = candidates.length;
    candidates = candidates.filter((n) => !openModels.has(n));
    const skipped = before - candidates.length;
    if (skipped > 0) logLine(`已跳过 ${skipped} 个官方列表中已开放的模型`);
  }
  if (!calib) {
    logLine('提示：未做“错误形态校准”，将按内置规则分类（建议先点校准）');
  }
  running = true;
  shouldStop = false;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  $('progressWrap').classList.remove('hidden');

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
        // 限流/网络错误自动重试一次
        if ((raw.status === 429 || raw.status === 0) && !shouldStop) {
          await sleep(1500);
          raw = await probeOnce(key, model);
        }
        const item = classify(model, raw);
        if (item.keyInvalid) {
          shouldStop = true;
          setStatus($('keyStatus'), 'err', '❌ Key 无效（身份验证失败），嗅探已停止');
          logLine(`Key 无效，终止全部嗅探：${model} → ${item.code} ${item.msg}`);
        }
        results[model] = item;
        logLine(`${model} → HTTP ${item.status} code=${item.code || '-'} [${CLS_META[item.cls].label}] ${item.msg || item.note || ''} ${item.latencyMs}ms`);
      } catch (e) {
        results[model] = { model, cls: 'unknown', status: -1, code: '', msg: String(e.message || e), latencyMs: 0, ts: Date.now(), sig: '' };
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
    const found = Object.values(results).filter((r) => r.cls === 'locked').length;
    logLine(`嗅探结束：本次共处理 ${done} 个，🔥存在·无权 ${found} 个`);
  }
};

$('stopBtn').onclick = () => {
  shouldStop = true;
  logLine('已请求停止，等待在途请求完成…');
};

// ---------------- 结果渲染 ----------------
function renderStats() {
  const c = { open: 0, locked: 0, likely: 0, notfound: 0, unknown: 0 };
  Object.values(results).forEach((r) => { if (c[r.cls] != null) c[r.cls]++; });
  $('statOpen').textContent = c.open;
  $('statLocked').textContent = c.locked;
  $('statLikely').textContent = c.likely;
  $('statNotFound').textContent = c.notfound;
  $('statUnknown').textContent = c.unknown;
  $('statTotal').textContent = Object.keys(results).length;
}

const ORDER = { locked: 0, likely: 1, open: 2, unknown: 3, notfound: 4 };

function renderResults() {
  const box = $('resultList');
  const items = Object.values(results)
    .filter((r) => currentFilter === 'all' || r.cls === currentFilter)
    .sort((a, b) => (ORDER[a.cls] - ORDER[b.cls]) || a.model.localeCompare(b.model));
  box.innerHTML = '';
  if (!items.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = currentFilter === 'all'
      ? '尚无结果 —— 配置好 Key 与候选名单后点「开始嗅探」。'
      : '该分类下暂无结果。';
    box.appendChild(d);
    return;
  }
  items.forEach((r) => {
    const meta = CLS_META[r.cls] || CLS_META.unknown;
    const card = document.createElement('div');
    card.className = `result r-${r.cls}`;
    const main = document.createElement('div');
    main.className = 'r-main';
    main.innerHTML = `<span class="r-icon">${meta.icon}</span><span class="r-name"></span><span class="badge b-${r.cls}">${meta.label}</span>`;
    main.querySelector('.r-name').textContent = r.model;
    card.appendChild(main);
    const sub = document.createElement('div');
    sub.className = 'r-sub';
    const extra = r.note ? ` · ${r.note}` : '';
    sub.textContent = `HTTP ${r.status} · code=${r.code || '-'} · ${r.msg || '-'}${extra} · ${r.latencyMs}ms`;
    card.appendChild(sub);
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
  const rows = [['model', 'class', 'http_status', 'code', 'message', 'note', 'latency_ms', 'probed_at']];
  Object.values(results).forEach((r) => rows.push([r.model, r.cls, r.status, r.code, r.msg, r.note || '', r.latencyMs, new Date(r.ts).toISOString()]));
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
    chip.className = 'chip' + (s === '' || s === '-flash' || s === '-air' ? ' on' : '');
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
  if (apiKey) {
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
  if (openModels.size > 0) {
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
    setStatus($('baselineStatus'), 'ok', `已载入历史拉取的 ${openModels.size} 个官方模型`);
  }
  logLine('页面就绪。建议流程：保存 Key → 拉取官方列表 → 校准 → 开始嗅探');
}

init();
})();
