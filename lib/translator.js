// OpenAI <-> chat.baidu.com translation.
import crypto from 'crypto';

// Map an OpenAI-ish model name to chat.baidu.com selectors.
//   smartMode + deepSearch(web) + thinkMode(reasoning)
export function resolveModel(modelStr) {
  const m = (modelStr || '').toLowerCase();
  const model = { modelName: 'smartMode', deepSearch: '0', thinkMode: '0' };
  if (m.includes('think') || m.includes('reason')) model.thinkMode = '1';
  if (m.includes('search') || m.includes('web')) model.deepSearch = '1';
  return model;
}

export const MODELS = [
  'ernie-noauth',
  'ernie-noauth-think',
  'ernie-noauth-search',
  'ernie-noauth-think-search',
];

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
