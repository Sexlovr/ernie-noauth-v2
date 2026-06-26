---
title: Ernie Noauth Proxy
emoji: 🦊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# ernie-noauth-proxy (Hugging Face Space)

This Space runs the browser-free OpenAI-compatible proxy over **chat.baidu.com**.
The image clones the code from GitHub at build time, so this Space only needs two
files: this `README.md` and `Dockerfile`.

## Deploy

1. Create a new **Docker** Space (Blank).
2. Add two files to the Space repo:
   - `README.md` — this file (keep the YAML header; `app_port: 7860` is required).
   - `Dockerfile` — the contents of `Dockerfile.hf` from the GitHub repo.
3. The build clones `github.com/Sexlovr/ernie-noauth-v2` (branch
   `noauth-v3-chatbaidu`) and starts automatically.

## Secrets / variables (Space → Settings)

| Name | Type | Purpose |
|---|---|---|
| `PROXIES` | secret | egress IPs, `host:port:user:pass` comma- or newline-separated. **Capacity scales with the number of IPs.** |
| `API_KEY` | secret | optional Bearer key required on `/v1/*` |
| `INCLUDE_DIRECT` | variable | `true` to also use the Space's own IP (default true) |
| `BUCKET_CAPACITY`, `BUCKET_REFILL_SEC`, `COOLDOWN_MS`, `MAX_RETRIES` | variable | per-IP rate tuning |

## Use

```
POST https://<user>-<space>.hf.space/v1/chat/completions
GET  https://<user>-<space>.hf.space/status   # live pool dashboard
```

## Updating

Push to GitHub, then **Factory rebuild** the Space (Settings → Factory rebuild) to
re-clone the latest commit. Or bump the `CACHEBUST` build-arg in the Dockerfile.
