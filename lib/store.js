// Tiny persistent key-value store, JSON-backed.
//
// Prefers Hugging Face's persistent mount at /data (added June 2026); falls back
// to ./data when /data is absent or read-only. Same resilient strategy glm2api
// uses — the app works either way; on a persistent /data the admin password,
// session secret and proxy list survive Space rebuilds.
import fs from 'fs';
import path from 'path';

function resolveDataDir() {
  const explicit = process.env.DATA_DIR;
  const candidates = explicit ? [explicit] : ['/data', path.join(process.cwd(), 'data')];
  for (const c of candidates) {
    if (!c) continue;
    try {
      fs.mkdirSync(c, { recursive: true });
      const t = path.join(c, '.write_test');
      fs.writeFileSync(t, 'ok');
      fs.rmSync(t);
      return c;
    } catch { /* try next */ }
  }
  const d = path.join(process.cwd(), 'data');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const DATA_DIR = resolveDataDir();
const FILE = path.join(DATA_DIR, 'ernie-store.json');

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { cache = {}; }
  return cache;
}
function persist() {
  try { fs.writeFileSync(FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.error('[store] persist failed:', e?.message || e); }
}

export function getSetting(key, dflt = null) {
  const c = load();
  return Object.prototype.hasOwnProperty.call(c, key) ? c[key] : dflt;
}
export function setSetting(key, val) {
  const c = load();
  c[key] = val;
  persist();
}
