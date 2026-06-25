// Single guest completion against chat.baidu.com/aichat/api/conversation.
//
// streamConversation() is an async generator yielding:
//   { kind: 'meta',     kunlun }   once, from the basedata event
//   { kind: 'reason',   text }     reasoning fragments (thinkMode)
//   { kind: 'delta',    text }     answer fragments (component markdown-yiyan)
//   { kind: 'depleted'           } IP hit the per-IP wall (kunlun_popup / status 1005)
//   { kind: 'error',    http, message }
//   { kind: 'done',     sawAnswer }
import { fetch } from 'undici';
import { UA } from './harvest.js';
import { mintChatToken } from './sign.js';

const URL = 'https://chat.baidu.com/aichat/api/conversation';

export function buildBody(query, session, model) {
  const ae = { inputT: null, ck1: 1, ck9: 700, ck10: 304 };
  const body = {
    message: {
      inputMethod: 'chat_search',
      isRebuild: false,
      content: { query: '', agentInfo: { agent_id: [''], params: '{"agt_rk":1,"agt_sess_cnt":1}' }, agentInfoList: [], qtype: 0 },
      searchInfo: {
        srcid: '', order: '', tplname: '', dqaKey: '', re_rank: '1', ori_lid: '', sa: 'bkb',
        enter_type: 'chat_url',
        chatParams: { setype: 'csaitab', chat_samples: 'WISE_NEW_CSAITAB', chat_token: mintChatToken(query, session.A, session.lid), scene: '' },
        isPrivateChat: false,
        usedModel: { modelName: model.modelName, modelFunction: { deepSearch: model.deepSearch, thinkMode: model.thinkMode } },
        landingPageSwitch: '', landingPage: 'aitab', ecomFrom: '', hasLocPermission: '', isInnovate: 2,
        applid: '', a_lid: '', showMindMap: false, deepDecisionInfo: { isDeepDecision: 0 },
      },
      from: '', source: 'pc_csaitab',
      query: [{ type: 'TEXT', data: { text: { query, extData: '{}', text_type: '' } } }],
      anti_ext: ae,
    },
    sa: 'bkb', setype: 'csaitab', rank: 1,
  };
  const xchat = `query:${encodeURIComponent(query)},anti_ext:${encodeURIComponent(JSON.stringify(ae))},enter_type:chat_url,re_rank:1,modelName:${model.modelName},sa:bkb`;
  return { body, xchat };
}

export async function* streamConversation({ session, query, model, dispatcher, signal }) {
  const { body, xchat } = buildBody(query, session, model);
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: {
        'x-chat-message': xchat,
        isdeepseek: '1',
        personifiedswitch: '0',
        referer: 'https://chat.baidu.com/search?internal=1',
        source: 'pc_csaitab',
        accept: 'text/event-stream',
        'content-type': 'application/json',
        landingpageswitch: '',
        'user-agent': UA,
        origin: 'https://chat.baidu.com',
        cookie: `BAIDUID=${session.baiduid}; BAIDUID_BFESS=${session.baiduid}`,
      },
      body: JSON.stringify(body),
      dispatcher,
      signal,
    });
  } catch (e) {
    yield { kind: 'error', http: 0, message: 'fetch failed: ' + (e?.message || e) };
    return;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) {
    const txt = await res.text().catch(() => '');
    yield { kind: 'error', http: res.status, message: `non-SSE (${res.status}): ${txt.slice(0, 200)}` };
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sawAnswer = false;
  let metaSent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let j;
        try { j = JSON.parse(line.slice(5)); } catch { continue; }

        // depletion — surfaces early in basedata (chatHitKunlun) or as status 1005
        if (j.chatHitKunlun === 'kunlun_popup' || j.status === 1005) { yield { kind: 'depleted' }; return; }

        if (!metaSent && j.chatHitKunlun !== undefined) { metaSent = true; yield { kind: 'meta', kunlun: j.chatHitKunlun }; }

        const g = j?.data?.message?.content?.generator;
        if (!g) continue;
        if (g.component === 'markdown-yiyan' && g.data?.value) { sawAnswer = true; yield { kind: 'delta', text: g.data.value }; }
        else if (g.component === 'thinkingSteps' && g.data?.value) { yield { kind: 'reason', text: g.data.value }; }
      }
    }
  } catch (e) {
    yield { kind: 'error', http: 0, message: 'stream aborted: ' + (e?.message || e) };
    return;
  }
  yield { kind: 'done', sawAnswer };
}
