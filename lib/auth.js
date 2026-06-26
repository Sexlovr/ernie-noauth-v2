// Admin authentication: PBKDF2 password hashing + signed-cookie sessions.
//
// No password is stored in plaintext or in env — on first run the dashboard shows
// a setup screen to create the admin password (hashed with PBKDF2-HMAC-SHA256 and
// stored in the persistent store). Sessions are stateless HMAC-signed cookies.
import crypto from 'crypto';
import { getSetting, setSetting } from './store.js';

const ROUNDS = 200_000;
const KEYLEN = 32;
const DIGEST = 'sha256';
export const COOKIE_NAME = 'ernie_session';
export const SESSION_TTL = 7 * 24 * 3600; // seconds

// ── password hashing ──
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync(pw, salt, ROUNDS, KEYLEN, DIGEST);
  return `pbkdf2$${salt.toString('hex')}$${dk.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [algo, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'pbkdf2') return false;
    const dk = crypto.pbkdf2Sync(pw, Buffer.from(saltHex, 'hex'), ROUNDS, KEYLEN, DIGEST);
    const want = Buffer.from(hashHex, 'hex');
    return dk.length === want.length && crypto.timingSafeEqual(dk, want);
  } catch { return false; }
}

// ── admin password state ──
export const isConfigured = () => getSetting('admin_password') != null;
export const setAdminPassword = (pw) => setSetting('admin_password', hashPassword(pw));
export function checkAdminPassword(pw) {
  const stored = getSetting('admin_password');
  return !!stored && verifyPassword(pw, stored);
}

// ── session signing ──
function secret() {
  let s = getSetting('session_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('session_secret', s); }
  return Buffer.from(s);
}
const b64 = (b) => Buffer.from(b).toString('base64url');

export function issueSession() {
  const payload = b64(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}
export function validSession(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  try {
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(payload, 'base64url')).exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

// Parse a single cookie out of a Cookie header (no dependency).
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
