// Configuration + egress (proxy) parsing.
import 'dotenv/config';
import fs from 'fs';
import { ProxyAgent, Agent } from 'undici';

const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

// Normalise one proxy line into a URL undici understands.
// Accepts:  http://user:pass@host:port  |  host:port:user:pass  |  host:port
function proxyLineToUrl(line) {
  const s = line.trim();
  if (!s || s.startsWith('#')) return null;
  if (s.includes('://')) return s.replace(/\/+$/, '');
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

function loadProxyLines() {
  const lines = [];
  if (process.env.PROXIES) lines.push(...process.env.PROXIES.split(/[\n,]+/));
  const file = process.env.PROXIES_FILE || 'proxies.txt';
  try {
    if (fs.existsSync(file)) lines.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/));
  } catch { /* ignore */ }
  return lines;
}

// Build the list of egress slots. Each slot is one independent rate-limit budget.
export function buildEgress() {
  const egress = [];
  const seen = new Set();

  if (bool(process.env.INCLUDE_DIRECT, true)) {
    egress.push({ id: 'direct', label: 'direct', url: null, dispatcher: new Agent({ connections: 8 }) });
  }

  for (const raw of loadProxyLines()) {
    const url = proxyLineToUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = url;
    try { host = new URL(url).host; } catch { /* keep raw */ }
    egress.push({ id: `proxy:${host}`, label: host, url, dispatcher: new ProxyAgent({ uri: url }) });
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
