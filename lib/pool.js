// Egress (IP) pool.
//
// The chat.baidu.com guest quota is per-EGRESS-IP, not per-cookie: a handful of
// requests per short rolling window, recovering in ~60s. So each slot here is one
// egress IP (a proxy, or the direct connection), and capacity scales with the
// number of IPs, NOT with the number of harvested cookies. Each slot holds one
// fresh cookie (auto re-harvested when stale or after the IP is walled).
//
// Per slot we run a token bucket to stay under the wall, and a cooldown that
// parks an IP for ~60s whenever it returns kunlun_popup / status 1005.
import { harvestSession } from './harvest.js';
import { config } from './config.js';

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Slot {
  constructor(egress) {
    this.id = egress.id;
    this.label = egress.label;
    this.dispatcher = egress.dispatcher;
    this.cookie = null;
    this.tokens = config.bucketCapacity;
    this.lastRefill = now();
    this.cooldownUntil = 0;
    this.busy = false;
    this.lastUsed = 0;
    this.stats = { ok: 0, depleted: 0, errors: 0, harvests: 0, harvestFails: 0 };
  }

  refill() {
    const perMs = 1 / (config.bucketRefillSec * 1000); // 1 token per refillSec seconds
    const elapsed = now() - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(config.bucketCapacity, this.tokens + elapsed * perMs);
    this.lastRefill = now();
  }

  cooling() { return now() < this.cooldownUntil; }

  ready() {
    if (this.busy || this.cooling()) return false;
    this.refill();
    return this.tokens >= 1;
  }

  cookieStale() {
    return !this.cookie || now() - this.cookie.harvestedAt > config.cookieTtlMs;
  }
}

export class Pool {
  constructor(egress) {
    this.slots = egress.map((e) => new Slot(e));
    if (this.slots.length === 0) throw new Error('No egress configured (need INCLUDE_DIRECT or proxies)');
  }

  size() { return this.slots.length; }
  healthy() { return this.slots.filter((s) => !s.cooling()).length; }

  // Replace the egress set at runtime (dashboard "save proxies"). Slots whose id
  // survives keep their warm cookie, stats and cooldown so the swap is seamless;
  // new ids start fresh; dropped ids are discarded.
  setEgress(egressList) {
    const old = new Map(this.slots.map((s) => [s.id, s]));
    const next = egressList.map((e) => {
      const slot = new Slot(e);
      const prev = old.get(e.id);
      if (prev) {
        slot.cookie = prev.cookie;
        slot.stats = prev.stats;
        slot.cooldownUntil = prev.cooldownUntil;
        slot.tokens = prev.tokens;
        slot.lastUsed = prev.lastUsed;
      }
      return slot;
    });
    if (next.length === 0) throw new Error('refusing to set empty egress');
    this.slots = next;
  }

  // Ensure a slot has a usable, fresh cookie. Returns true on success.
  async ensureCookie(slot) {
    if (!slot.cookieStale()) return true;
    slot.stats.harvests++;
    const sess = await harvestSession(slot.dispatcher);
    if (!sess) { slot.stats.harvestFails++; return false; }
    slot.cookie = sess;
    return true;
  }

  // Acquire a ready slot with a fresh cookie. Waits up to timeoutMs.
  // `exclude` is a Set of slot ids already tried by this request.
  async acquire({ exclude = new Set(), timeoutMs = config.acquireTimeoutMs } = {}) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const candidates = this.slots
        .filter((s) => !exclude.has(s.id) && s.ready())
        .sort((a, b) => a.lastUsed - b.lastUsed);

      for (const slot of candidates) {
        if (slot.busy) continue;
        slot.busy = true; // reserve before the await
        const ok = await this.ensureCookie(slot);
        if (!ok) {
          // bad harvest on this IP — brief park, free it, try another
          slot.cooldownUntil = now() + 5000;
          slot.busy = false;
          continue;
        }
        slot.tokens -= 1;
        slot.lastUsed = now();
        return slot;
      }

      // nothing ready right now (all cooling / out of tokens / excluded) — wait a bit
      if (this.slots.every((s) => exclude.has(s.id))) return null; // exhausted every slot
      await sleep(150);
    }
    return null;
  }

  release(slot, outcome) {
    slot.busy = false;
    switch (outcome) {
      case 'ok':
        slot.stats.ok++;
        break;
      case 'depleted':
        slot.stats.depleted++;
        slot.cooldownUntil = now() + config.cooldownMs;
        slot.cookie = null; // re-harvest after cooldown
        break;
      case 'error':
      default:
        slot.stats.errors++;
        slot.cooldownUntil = now() + 5000;
        slot.cookie = null;
        break;
    }
  }

  // Background warmer: keep ready slots pre-supplied with a fresh cookie so the
  // first request on them doesn't pay the harvest latency.
  startWarmer(intervalMs = 5000) {
    this._warmer = setInterval(async () => {
      for (const slot of this.slots) {
        if (slot.busy || slot.cooling() || !slot.cookieStale()) continue;
        slot.busy = true;
        try { await this.ensureCookie(slot); } catch { /* ignore */ }
        slot.busy = false;
      }
    }, intervalMs);
    if (this._warmer.unref) this._warmer.unref();
  }

  stopWarmer() { if (this._warmer) clearInterval(this._warmer); }

  snapshot() {
    return {
      size: this.size(),
      healthy: this.healthy(),
      slots: this.slots.map((s) => ({
        id: s.id,
        label: s.label,
        cooling: s.cooling(),
        cooldownInMs: Math.max(0, s.cooldownUntil - now()),
        tokens: Math.floor((s.refill(), s.tokens)),
        hasCookie: !!s.cookie,
        ...s.stats,
      })),
    };
  }
}
