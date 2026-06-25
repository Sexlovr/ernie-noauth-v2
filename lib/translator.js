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
