// Configuration + egress (proxy) parsing.
import 'dotenv/config';
import fs from 'fs';
import { ProxyAgent, Agent } from 'undici';

const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

// Normalise one proxy line into a URL undici understands.
// Accepts:  http://user:pass@host:port  |  host:port:user:pass  |  host:port
export function proxyLineToUrl(line) {
  const s = (line || '').trim();
  if (!s || s.startsWith('#')) return null;
  if (s.includes('://')) return s.replace(/\/+$/, '');
  // user:pass@host:port
  const at = s.indexOf('@');
  if (at >= 0) {
    const creds = s.slice(0, at), hp = s.slice(at + 1);
    const ci = creds.indexOf(':');
    const user = ci >= 0 ? creds.slice(0, ci) : creds;
    const pass = ci >= 0 ? creds.slice(ci + 1) : '';
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hp}`;
  }
  const parts = s.split(':');
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }
  if (parts.length === 2) {
    const [host, port] = parts;
    return `http://${host}:${port}`;
  }
  return null;
}

// Split a textarea / env blob into individual proxy lines.
export function parseProxyText(text) {
  return String(text || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

// Initial proxy text + include-direct flag from env/file (used to seed the store
// on first boot, before anything is saved via the dashboard).
export function envProxyText() {
  let text = process.env.PROXIES || '';
  const file = process.env.PROXIES_FILE || 'proxies.txt';
  try { if (fs.existsSync(file)) text += '\n' + fs.readFileSync(file, 'utf8'); } catch { /* ignore */ }
  return text.trim();
}
export const envIncludeDirect = () => bool(process.env.INCLUDE_DIRECT, true);

// Build egress slots from proxy lines + an include-direct flag. Each slot is one
// independent per-IP rate budget. Safe-guards to always return at least one slot.
export function egressFromLines(lines, includeDirect) {
  const egress = [];
  const seen = new Set();

  for (const raw of lines || []) {
    const url = proxyLineToUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = url;
    try { host = new URL(url).host; } catch { /* keep raw */ }
    egress.push({ id: `proxy:${host}`, label: host, url, dispatcher: new ProxyAgent({ uri: url }) });
  }

  // include direct if asked, OR if there are no proxies (never return empty)
  if (includeDirect || egress.length === 0) {
    egress.unshift({ id: 'direct', label: 'direct', url: null, dispatcher: new Agent({ connections: 8 }) });
  }
  return egress;
}

export const config = {
  port: num(process.env.PORT, 7860),
  apiKey: process.env.API_KEY || '',              // if set, require Bearer match
  // per-IP token bucket (pre-throttle below the ~per-minute wall)
  bucketCapacity: num(process.env.BUCKET_CAPACITY, 4),
  bucketRefillSec: num(process.env.BUCKET_REFILL_SEC, 12), // 1 token per N seconds
  // cooldown applied to an IP after it returns kunlun_popup / 1005
  cooldownMs: num(process.env.COOLDOWN_MS, 60000),
  // re-harvest a slot's cookie once it is older than this
  cookieTtlMs: num(process.env.COOKIE_TTL_MS, 600000),
  // how long a single completion will hop across slots before giving up
  maxRetries: num(process.env.MAX_RETRIES, 6),
  acquireTimeoutMs: num(process.env.ACQUIRE_TIMEOUT_MS, 20000),
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 120000),
};
