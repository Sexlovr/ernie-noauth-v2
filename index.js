// ernie-noauth proxy — OpenAI-compatible front over chat.baidu.com guest chat.
// Browser-free. Capacity scales with egress IPs (proxies + direct), each an
// independent per-IP rate budget managed by the pool.
import express from 'express';
import { fetch as uFetch } from 'undici';
import { config, egressFromLines, parseProxyText, envProxyText, envIncludeDirect } from './lib/config.js';
import { Pool } from './lib/pool.js';
import { streamConversation } from './lib/baiduClient.js';
import { resolveModel, messagesToQuery, MODELS, newId, streamChunk, fullResponse, makeStreamFilter, stripFollowupTail, estimateTokens } from './lib/translator.js';
import { DATA_DIR, getSetting, setSetting } from './lib/store.js';
import { UA } from './lib/harvest.js';
import * as auth from './lib/auth.js';
import { setupHtml, loginHtml, dashboardHtml } from './lib/page.js';

// ── seed egress from the persistent store, falling back to env/file on first run ──
function currentProxyConfig() {
  const savedText = getSetting('proxies');
  const text = savedText != null ? savedText : envProxyText();
  const savedDirect = getSetting('include_direct');
  const includeDirect = savedDirect != null ? !!savedDirect : envIncludeDirect();
  return { text, includeDirect };
}
const seed = currentProxyConfig();
const pool = new Pool(egressFromLines(parseProxyText(seed.text), seed.includeDirect));
pool.startWarmer();
console.log(`[store] data dir: ${DATA_DIR}`);
console.log(`[pool] ${pool.size()} egress slot(s): ${pool.snapshot().slots.map((s) => s.label).join(', ')}`);

const app = express();
app.use(express.json({ limit: '16mb' }));

// ── admin auth (cookie session) ──
function adminAuthed(req) {
  return auth.validSession(auth.readCookie(req.headers.cookie, auth.COOKIE_NAME));
}
function sessionCookie(token) {
  return `${auth.COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.SESSION_TTL}`;
}
function requireAdmin(req, res) {
  if (adminAuthed(req)) return true;
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return false;
}

// ── auth ──
function authed(req, res) {
  if (!config.apiKey) return true;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got === config.apiKey) return true;
  res.status(401).json({ error: { message: 'invalid api key', type: 'invalid_request_error' } });
  return false;
}

// Drive one completion across the pool. Retries on another IP whenever a slot is
// walled (kunlun) or errors BEFORE any answer text has been emitted. onDelta is
// only ever called with real answer text, so once it fires we are committed.
async function generate({ query, model, signal, onDelta, onReason }) {
  const tried = new Set();
  let lastErr = 'no egress available';
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    const slot = await pool.acquire({ exclude: tried });
    if (!slot) break;
    tried.add(slot.id);
    let got = false;
    let outcome = 'error';
    try {
      for await (const ev of streamConversation({ session: slot.cookie, query, model, dispatcher: slot.dispatcher, signal })) {
        if (ev.kind === 'delta') { got = true; outcome = 'ok'; onDelta(ev.text); }
        else if (ev.kind === 'reason') { onReason?.(ev.text); }
        else if (ev.kind === 'depleted') { outcome = 'depleted'; lastErr = 'all egress IPs rate-limited (kunlun)'; break; }
        else if (ev.kind === 'error') { outcome = 'error'; lastErr = ev.message; break; }
        else if (ev.kind === 'done') { outcome = got ? 'ok' : 'error'; if (!got) lastErr = 'empty response'; }
      }
    } catch (e) {
      if (signal?.aborted) { pool.release(slot, got ? 'ok' : 'error'); return { ok: false, aborted: true }; }
      outcome = 'error'; lastErr = e?.message || String(e);
    }
    pool.release(slot, got ? 'ok' : outcome);
    if (got) return { ok: true };
    if (signal?.aborted) return { ok: false, aborted: true };
  }
  return { ok: false, error: lastErr };
}

app.post('/v1/chat/completions', async (req, res) => {
  if (!authed(req, res)) return;
  const { messages, model = 'ernie-noauth', stream = false } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
  }

  // Conversation strategy: chat.baidu.com guest sessions are single-shot — native
  // multi-turn is stateful (sessionId + msgId continuation), impractical to replay
  // in a stateless OpenAI proxy and rate-limited per IP. So we flatten the whole
  // message array into one role-tagged prompt; the model sees full context and
  // continues correctly (verified). File upload (BOS) is gated behind a logged-in
  // account, so >~100k-token contexts can't be offloaded to a file on the guest
  // path — we send them inline and surface any upstream size error.
  let query = messagesToQuery(messages);
  const resolved = resolveModel(model);
  if (resolved.english) query = 'Please respond entirely in English, regardless of the input language.\n\n' + query;
  const approxTokens = estimateTokens(query);
  if (approxTokens > 100_000) console.warn(`[completion] large prompt ~${approxTokens} tok — sending inline (no guest file-dump)`);
  const id = newId();

  const ac = new AbortController();
  // abort only on real client disconnect (res 'close' before we finish) — NOT on
  // req 'close', which fires as soon as the POST body is consumed.
  let finished = false;
  res.on('close', () => { if (!finished) ac.abort(); });
  const timeout = setTimeout(() => ac.abort(), config.requestTimeoutMs);

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      let opened = false;
      const filt = makeStreamFilter();
      const emit = (text) => {
        if (!text) return;
        if (!opened) { opened = true; res.write(streamChunk(id, model, { role: 'assistant', content: '' })); }
        res.write(streamChunk(id, model, { content: text }));
      };
      const r = await generate({
        query, model: resolved, signal: ac.signal,
        onDelta: (text) => emit(filt.push(text)),
      });
      if (r.aborted) return res.end();
      emit(filt.flush());
      if (!r.ok && !opened) {
        res.write(streamChunk(id, model, { role: 'assistant', content: `[proxy error: ${r.error}]` }));
      }
      res.write(streamChunk(id, model, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      let content = '';
      const r = await generate({ query, model: resolved, signal: ac.signal, onDelta: (t) => { content += t; } });
      if (r.aborted) return;
      if (!r.ok) return res.status(502).json({ error: { message: r.error, type: 'upstream_error' } });
      res.json(fullResponse(id, model, stripFollowupTail(content)));
    }
  } finally {
    finished = true;
    clearTimeout(timeout);
  }
});

app.get('/v1/models', (req, res) => {
  res.json({ object: 'list', data: MODELS.map((m) => ({ id: m, object: 'model', created: 0, owned_by: 'baidu' })) });
});

app.get('/health', (req, res) => res.json({ ok: true, healthy: pool.healthy(), size: pool.size() }));

app.get('/status', (req, res) => {
  const snap = pool.snapshot();
  if ((req.headers.accept || '').includes('application/json') || req.query.json !== undefined) return res.json(snap);
  const rows = snap.slots.map((s) =>
    `<tr><td>${s.label}</td><td>${s.cooling ? `cooling ${Math.ceil(s.cooldownInMs / 1000)}s` : 'ready'}</td>` +
    `<td>${s.tokens}</td><td>${s.hasCookie ? '✓' : '—'}</td><td>${s.ok}</td><td>${s.depleted}</td><td>${s.errors}</td></tr>`
  ).join('');
  res.send(`<!doctype html><meta charset=utf8><title>ernie-noauth pool</title>
<style>body{font:14px system-ui;margin:2rem;background:#0b0d10;color:#e6e6e6}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #2a2f37;padding:6px 10px;text-align:left}th{background:#161b22}h1{font-size:18px}</style>
<h1>ernie-noauth pool — ${snap.healthy}/${snap.size} healthy</h1>
<table><tr><th>egress</th><th>state</th><th>tokens</th><th>cookie</th><th>ok</th><th>depleted</th><th>errors</th></tr>${rows}</table>
<p style=color:#8b949e>auto-refreshing every 3s</p><script>setTimeout(()=>location.reload(),3000)</script>`);
});

// ── admin dashboard ──
app.get('/', (req, res) => {
  if (!auth.isConfigured()) return res.type('html').send(setupHtml);
  if (!adminAuthed(req)) return res.type('html').send(loginHtml);
  res.type('html').send(dashboardHtml);
});

app.post('/admin/api/setup', (req, res) => {
  if (auth.isConfigured()) return res.status(400).json({ ok: false, error: 'already configured' });
  const pw = (req.body?.password || '').trim();
  if (pw.length < 8) return res.status(400).json({ ok: false, error: 'password must be at least 8 characters' });
  auth.setAdminPassword(pw);
  res.setHeader('Set-Cookie', sessionCookie(auth.issueSession()));
  res.json({ ok: true });
});

app.post('/admin/api/login', (req, res) => {
  if (!auth.checkAdminPassword(req.body?.password || '')) return res.status(401).json({ ok: false, error: 'wrong password' });
  res.setHeader('Set-Cookie', sessionCookie(auth.issueSession()));
  res.json({ ok: true });
});

app.post('/admin/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/admin/api/status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cfg = currentProxyConfig();
  res.json({
    ok: true,
    pool: pool.snapshot(),
    proxies: { text: cfg.text, includeDirect: cfg.includeDirect, count: parseProxyText(cfg.text).length },
    models: MODELS,
    auth_required: !!config.apiKey,
    api_base: '/v1',
  });
});

app.post('/admin/api/proxies', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const text = String(req.body?.text ?? '');
  const includeDirect = !!req.body?.includeDirect;
  const lines = parseProxyText(text);
  try {
    const egress = egressFromLines(lines, includeDirect);
    pool.setEgress(egress);
    setSetting('proxies', text);
    setSetting('include_direct', includeDirect);
    res.json({ ok: true, count: lines.length, size: pool.size() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});

// Probe each proxy's egress IP (reachability, not WAF acceptance).
app.post('/admin/api/proxies/test', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const lines = parseProxyText(req.body?.text ?? '');
  // build one ephemeral egress per line (skip direct)
  const slots = egressFromLines(lines, false).filter((e) => e.url);
  const probe = async (e) => {
    const t0 = Date.now();
    let host = e.url, user = null;
    try { const u = new URL(e.url); host = u.host; user = u.username ? u.username.slice(0, 3) + '***' : null; } catch { /* keep */ }
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 12000);
      const r = await uFetch('https://api.ipify.org?format=json', { dispatcher: e.dispatcher, signal: ac.signal, headers: { 'user-agent': UA } });
      clearTimeout(to);
      const j = await r.json().catch(() => ({}));
      return { server: host, username: user, ok: true, ip: j.ip || '?', ms: Date.now() - t0 };
    } catch (err) {
      return { server: host, username: user, ok: false, error: err?.message || String(err) };
    }
  };
  const results = await Promise.all(slots.slice(0, 32).map(probe));
  res.json({ ok: true, results, okCount: results.filter((r) => r.ok).length });
});

app.listen(config.port, '0.0.0.0', () => console.log(`ernie-noauth proxy on :${config.port}`));
