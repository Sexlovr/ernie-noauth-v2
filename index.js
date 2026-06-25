// ernie-noauth proxy — OpenAI-compatible front over chat.baidu.com guest chat.
// Browser-free. Capacity scales with egress IPs (proxies + direct), each an
// independent per-IP rate budget managed by the pool.
import express from 'express';
import { config, buildEgress } from './lib/config.js';
import { Pool } from './lib/pool.js';
import { streamConversation } from './lib/baiduClient.js';
import { resolveModel, messagesToQuery, MODELS, newId, streamChunk, fullResponse } from './lib/translator.js';

const egress = buildEgress();
const pool = new Pool(egress);
pool.startWarmer();
console.log(`[pool] ${pool.size()} egress slot(s): ${egress.map((e) => e.label).join(', ')}`);

const app = express();
app.use(express.json({ limit: '16mb' }));

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

  const query = messagesToQuery(messages);
  const resolved = resolveModel(model);
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
      const r = await generate({
        query, model: resolved, signal: ac.signal,
        onDelta: (text) => {
          if (!opened) { opened = true; res.write(streamChunk(id, model, { role: 'assistant', content: '' })); }
          res.write(streamChunk(id, model, { content: text }));
        },
      });
      if (r.aborted) return res.end();
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
      res.json(fullResponse(id, model, content));
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

app.listen(config.port, '0.0.0.0', () => console.log(`ernie-noauth proxy on :${config.port}`));
