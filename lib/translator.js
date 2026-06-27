// OpenAI <-> chat.baidu.com translation.
import crypto from 'crypto';

// Real chat.baidu.com models (exact upstream `modelName`, and which search flag
// each one uses — smartMode uses deepSearch, the rest use internetSearch).
// `think`: 'toggle' = optional reasoning, 'forced' = always reasons (DS-R1).
const BASES = {
  'smart':            { modelName: 'smartMode',          search: 'deepSearch',     think: 'toggle', title: 'Smart (auto-routes)' },
  'deepseek-v4':      { modelName: 'DeepSeek-V4',         search: 'internetSearch', think: 'toggle', title: 'DeepSeek-V4 Pro' },
  'deepseek-v4-flash':{ modelName: 'DeepSeek-V4-Flash',   search: 'internetSearch', think: 'toggle', title: 'DeepSeek-V4 Flash' },
  'deepseek-r1':      { modelName: 'DeepSeek-R1',         search: 'internetSearch', think: 'forced', title: 'DeepSeek-R1' },
  'ernie-5.1':        { modelName: 'ERINE-5.1',           search: 'internetSearch', think: 'toggle', title: 'ERNIE 5.1 (文心)' },
};
// Aliases users may type for a base (longest match wins).
const ALIASES = [
  ['deepseek-v4-flash', ['deepseek-v4-flash', 'deepseek-flash', 'ds-v4-flash', 'ds-flash', 'v4-flash']],
  ['deepseek-r1',       ['deepseek-r1', 'deepseek-reasoner', 'ds-r1', 'r1']],
  ['deepseek-v4',       ['deepseek-v4', 'deepseek-v4-pro', 'deepseek-pro', 'deepseek', 'ds-v4', 'ds-pro', 'v4']],
  ['ernie-5.1',         ['ernie-5.1', 'ernie-5', 'ernie5', 'ernie', 'wenxin', 'yiyan']],
  ['smart',             ['smart', 'auto', 'smartmode', 'ernie-noauth', 'baidu', 'baidu-smart']],
];

// Flatten to (alias, base) pairs sorted by alias length desc, so the most
// specific match wins (e.g. "ernie-noauth" -> smart before "ernie" -> ernie-5.1,
// and "deepseek-v4-flash" before "deepseek-v4" before "deepseek").
const ALIAS_PAIRS = ALIASES.flatMap(([base, names]) => names.map((n) => [n, base]))
  .sort((a, b) => b[0].length - a[0].length);

function matchBase(s) {
  for (const [n, base] of ALIAS_PAIRS) if (s.includes(n)) return base;
  return 'smart';
}

// Resolve an OpenAI-ish model id -> upstream selectors. Suffix tokens stack:
//   -think/-reason (reasoning) · -search/-web (web) · -research (search+think) ·
//   -en/-english (answer in English).
export function resolveModel(modelStr) {
  const raw = (modelStr || '').toLowerCase();
  const base = BASES[matchBase(raw)];
  const has = (re) => re.test(raw);
  const research = has(/research/);
  const wantThink = research || has(/think|reason/);
  const wantSearch = research || has(/search|web|online/);
  const english = has(/(^|[-_])(en|english)([-_]|$)/);

  const modelFunction = { internetSearch: '0', deepSearch: '0', thinkMode: '0' };
  if (wantSearch) modelFunction[base.search] = '1';
  if (wantThink || base.think === 'forced') modelFunction.thinkMode = '1';
  return { modelName: base.modelName, modelFunction, english, label: base.title };
}

// Models advertised on /v1/models + the dashboard. Legacy `ernie-noauth*` ids are
// kept as smartMode aliases for back-compat.
export const MODELS = [
  'ernie-noauth', 'ernie-noauth-think', 'ernie-noauth-search', 'ernie-noauth-think-search',
  'deepseek-v4', 'deepseek-v4-search', 'deepseek-v4-think',
  'deepseek-v4-flash', 'deepseek-v4-flash-think',
  'deepseek-r1', 'deepseek-r1-search',
  'ernie-5.1', 'ernie-5.1-search', 'ernie-5.1-think',
  'baidu-smart', 'baidu-smart-search', 'baidu-smart-research',
];

// Rough token estimate: CJK ≈ 1 token/char, other text ≈ 1 token / 4 chars.
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ]/g) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

// chat.baidu.com's conversation endpoint is single-turn per harvested session, so
// we flatten the OpenAI message array into one prompt string with role tags.
export function messagesToQuery(messages) {
  if (!Array.isArray(messages)) return '';
  const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text || '').join('') : '');
  const parts = [];
  for (const msg of messages) {
    const content = flat(msg?.content).trim();
    if (!content) continue;
    const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'system' ? 'System' : 'User';
    parts.push(`[${role}]:\n${content}`);
  }
  let q = parts.join('\n\n').trim();
  // If the convo ends on a user turn, nudge the model to answer as assistant.
  if (messages[messages.length - 1]?.role !== 'assistant') q += '\n\n[Assistant]:';
  return q;
}

// chat.baidu.com sometimes appends a follow-up "suggestion" block to the answer:
// a markdown horizontal rule (---/***/___) followed by a short Chinese prompt like
// "需要我帮你…？". Strip that trailing block. No-op when absent — clean answers are
// returned byte-for-byte unchanged.
const SUGGEST_RE = /需要我|要不要|是否需要|希望我|你可以|可以问我|还想|想了解|继续帮你|我还能|我还可以|如需|如果你/;
// blank-line (optional) + a horizontal-rule line.
const SEP_RE = /\n[ \t]*\n?[ \t]*[-*_]{3,}[ \t]*(?:\n|$)/g;

export function stripFollowupTail(text) {
  if (!text) return text;
  let last = -1, lastEnd = -1, m;
  SEP_RE.lastIndex = 0;
  while ((m = SEP_RE.exec(text))) { last = m.index; lastEnd = SEP_RE.lastIndex; }
  if (last < 0) return text;
  const after = text.slice(lastEnd);
  if (after.length <= 500 && SUGGEST_RE.test(after)) return text.slice(0, last).replace(/\s+$/, '');
  return text;
}

// Streaming-safe version: feed deltas through push(); it emits text that is
// definitely not part of a trailing suggestion block, holding back any tail that
// might be (or might grow into) one. Call flush() once at end to release/strip it.
export function makeStreamFilter() {
  let held = '';
  return {
    push(t) {
      held += t;
      // Once a full HR separator is seen, hold everything from it onward — a
      // suggestion block may follow, and flush() decides whether to drop it.
      SEP_RE.lastIndex = 0;
      const sep = SEP_RE.exec(held);
      if (sep) {
        const out = held.slice(0, sep.index);
        held = held.slice(sep.index);
        return out;
      }
      // No full separator yet: hold back only a trailing run that could still
      // grow into one (newlines/spaces optionally followed by rule chars).
      const tm = held.match(/\n[ \t\n]*[-*_ \t]*$/);
      if (tm) { const out = held.slice(0, tm.index); held = held.slice(tm.index); return out; }
      const out = held; held = '';
      return out;
    },
    flush() { const out = stripFollowupTail(held); held = ''; return out; },
  };
}

export const newId = () => 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '');

export function streamChunk(id, model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

export function fullResponse(id, model, content, finishReason = 'stop') {
  // chat.baidu.com gives no token accounting; report rough word-ish counts.
  const completion = content ? content.split(/\s+/).filter(Boolean).length : 0;
  return {
    id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: completion, total_tokens: completion },
  };
}
