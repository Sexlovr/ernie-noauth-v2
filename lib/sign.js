// chat.baidu.com guest chat_token signing (reverse-engineered).
//
//   chat_token = base64(`${A}|${md5(query)}|${Date.now()}|${lid}`) + `-${lid}-3`
//
// where A (=aiTabFrameBaseData.token) and lid (=aiTabFrameBaseData.lid) are a
// matched, server-issued pair scraped from the landing-page HTML at harvest time.
import crypto from 'crypto';

export const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

export function mintChatToken(query, A, lid) {
  const inner = `${A}|${md5(query)}|${Date.now()}|${lid}`;
  return Buffer.from(inner, 'utf8').toString('base64') + `-${lid}-3`;
}
