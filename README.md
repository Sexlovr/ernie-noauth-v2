---
title: Ernie Noauth Proxy
emoji: 🚀
sdk: docker
pinned: false
---

# ernie-noauth-proxy

OpenAI-compatible `/v1/chat/completions` bridge over **chat.baidu.com** guest chat.
**No login, no captcha, no browser** — every request harvests a guest session over
plain HTTP and signs the `chat_token` itself.

## How it works

1. **Harvest** — one cookieless `GET https://chat.baidu.com/` yields `BAIDUID`
   (Set-Cookie) plus `{token, lid}` (inline `aiTabFrameBaseData` JSON).
2. **Sign** — `chat_token = base64(`A|md5(query)|now|lid`) + "-lid-3"`.
3. **Complete** — `POST /aichat/api/conversation`; the answer streams back in
   `markdown-yiyan` fragments, translated to OpenAI chunks.

## The catch: the limit is per-IP

The guest quota is enforced on the **egress IP**, not the cookie — a few requests
per short window, recovering in ~60s. Harvesting more cookies does **not** help;
they all share one IP's budget. **Capacity scales with the number of egress IPs.**

So the pool is keyed on IPs. Each slot (a proxy, or the direct connection) holds
one fresh cookie, is throttled by a per-IP token bucket, and is parked for ~60s
when it returns `kunlun_popup` / status `1005`. A single completion transparently
hops to another IP if the one it picked is walled before any text is produced.

## Setup

```bash
npm install
cp .env.example .env
cp proxies.example.txt proxies.txt   # paste your proxies (one per line)
npm start
```

Get IPs free: **Webshare** (10 datacenter IPs, 1 GB/mo), stack **Oxylabs** (5) and
**Bright Data** (15) to reach ~30. Paste them into `proxies.txt`
(`host:port:user:pass`, the Webshare export format, works directly).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | OpenAI chat (stream + non-stream) |
| `GET /v1/models` | model list |
| `GET /status` | live pool dashboard (HTML; `?json` for JSON) |
| `GET /health` | health check |

Models: `ernie-noauth`, `-think` (reasoning), `-search` (web), `-think-search`.
Set `API_KEY` in `.env` to require a Bearer key.

## Tuning

`BUCKET_CAPACITY` / `BUCKET_REFILL_SEC` (per-IP rate), `COOLDOWN_MS` (wall park
time), `COOKIE_TTL_MS`, `MAX_RETRIES`. Defaults are conservative — raise the rate
as you add IPs.
