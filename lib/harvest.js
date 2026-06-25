// Browser-free guest-session harvest.
//
// A single cookieless GET to https://chat.baidu.com/ returns everything we need
// to talk to the chat API as a guest:
//   - BAIDUID            (Set-Cookie header)
//   - token (=A) + lid   (inline <script name="aiTabFrameBaseData">{...}</script>)
//
// Pass an undici dispatcher (ProxyAgent) to harvest through a specific egress IP;
// the BAIDUID/quota is bound to that IP, not to the cookie.
import { fetch } from 'undici';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const BASE_RE = /name="aiTabFrameBaseData">(\{.*?\})<\/script>/s;

export async function harvestSession(dispatcher, { timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch('https://chat.baidu.com/', {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
      dispatcher,
      signal: ac.signal,
    });
    if (!r.ok) return null;
    const html = await r.text();

    const jar = {};
    for (const c of r.headers.getSetCookie()) {
      const m = /^([^=]+)=([^;]+)/.exec(c);
      if (m) jar[m[1]] = m[2];
    }

    const m = html.match(BASE_RE);
    let base = null;
    if (m) { try { base = JSON.parse(m[1]); } catch { /* malformed */ } }

    const baiduid = jar.BAIDUID || jar.BAIDUID_BFESS;
    if (!baiduid || !base?.token || !base?.lid) return null;

    return { baiduid, A: base.token, lid: String(base.lid), harvestedAt: Date.now() };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
