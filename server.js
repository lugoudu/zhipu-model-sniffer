#!/usr/bin/env node
/**
 * 智谱模型嗅探站 —— 本地服务
 *
 * 职责（纯透传，不做任何记录）：
 *   1. 托管 public/ 下的静态页面
 *   2. /api/probe  : 转发单次模型嗅探请求到智谱 chat/completions
 *   3. /api/models : 转发模型列表拉取请求
 *
 * 为什么需要本地代理：浏览器直连 open.bigmodel.cn 会被 CORS 拦截。
 * 本服务只在内存中转发请求，不落盘、不打印 API Key。
 *
 * 启动：node server.js   （默认 http://localhost:8787）
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ZHIPU_BASE = 'open.bigmodel.cn';
const CHAT_PATH = '/api/paas/v4/chat/completions';
const MODELS_PATH = '/api/paas/v4/models';

// 对智谱出站请求的全局节流：令牌桶，避免高并发触发平台风控/限流。
// 默认每秒最多 4 个出站请求，可用环境变量 OUTBOUND_RPS 调整。
const OUTBOUND_RPS = Math.max(1, Number(process.env.OUTBOUND_RPS) || 4);
const OUTBOUND_TIMEOUT_MS = 25000;
const MAX_BODY_BYTES = 64 * 1024; // 请求体上限，够用且防滥用

let tokens = OUTBOUND_RPS;
let lastRefill = Date.now();
function takeToken() {
  const now = Date.now();
  tokens = Math.min(OUTBOUND_RPS, tokens + ((now - lastRefill) / 1000) * OUTBOUND_RPS);
  lastRefill = now;
  if (tokens >= 1) {
    tokens -= 1;
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 向智谱发起一次透传请求。
 * 返回 { status, body(文本), latencyMs }；网络层失败时 status 为 0。
 */
function forwardZhipu(method, apiPath, apiKey, bodyText) {
  return new Promise((resolve) => {
    const started = Date.now();
    const payload = bodyText || null;
    const req = https.request(
      {
        hostname: ZHIPU_BASE,
        path: apiPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        },
        timeout: OUTBOUND_TIMEOUT_MS,
      },
      (upstream) => {
        const chunks = [];
        upstream.on('data', (c) => chunks.push(c));
        upstream.on('end', () => {
          resolve({
            status: upstream.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
            latencyMs: Date.now() - started,
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('upstream timeout'));
    });
    req.on('error', (err) => {
      resolve({ status: 0, body: JSON.stringify({ error: { code: 'network', message: String(err.message || err) } }), latencyMs: Date.now() - started });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** 嗅探请求体：max_tokens=1 最小化消耗（免费模型零成本，付费模型至多 1 个输出 token） */
function buildProbeBody(model) {
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
    stream: false,
  });
}

async function handleProbe(req, res) {
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    return;
  }
  const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
  if (!apiKey || !model) {
    sendJson(res, 400, { ok: false, error: '缺少 apiKey 或 model' });
    return;
  }
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(model)) {
    sendJson(res, 400, { ok: false, error: '模型名称含非法字符' });
    return;
  }
  // 等令牌，最多等 3 秒，等不到就直接限流应答（前端自己有重试/间隔）
  let waited = 0;
  while (!takeToken()) {
    if (waited >= 3000) {
      sendJson(res, 429, { ok: false, error: '本地出站限速中，请稍后重试' });
      return;
    }
    await sleep(100);
    waited += 100;
  }
  const result = await forwardZhipu('POST', CHAT_PATH, apiKey, buildProbeBody(model));
  sendJson(res, 200, { ok: true, model, ...result });
}

async function handleModels(req, res) {
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    return;
  }
  const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
  if (!apiKey) {
    sendJson(res, 400, { ok: false, error: '缺少 apiKey' });
    return;
  }
  const result = await forwardZhipu('GET', MODELS_PATH, apiKey, null);
  sendJson(res, 200, { ok: true, ...result });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;
  try {
    if (req.method === 'POST' && pathname === '/api/probe') {
      await handleProbe(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/models') {
      await handleModels(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'zhipu-model-sniffer', outboundRps: OUTBOUND_RPS });
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res, pathname);
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  智谱模型嗅探站已启动');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  出站限速：${OUTBOUND_RPS} 次/秒（可用环境变量 OUTBOUND_RPS 调整）`);
  console.log('  API Key 仅在内存中转发，本服务不落盘、不打印。Ctrl+C 停止。');
  console.log('');
});
