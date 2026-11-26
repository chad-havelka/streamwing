// Lost her private link? She proves she owns the room by pasting the Events API link
// Chaturbate shows her on its token page. If it matches the link saved for that room,
// we issue a new private key. The old key stops working at once. Her history stays.
import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { decrypt, hashKey, newAccessKey } from './crypto.js';
import { parseEventsUrl } from './cb.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;
const tries = new Map();   // ip -> { n, reset }. In memory: resets on restart, which is fine for this.

function allowed(ip) {
  const now = Date.now();
  const t = tries.get(ip);
  if (!t || now > t.reset) { tries.set(ip, { n: 1, reset: now + WINDOW_MS }); return true; }
  t.n += 1;
  return t.n <= MAX_TRIES;
}

function same(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function recoverLink(input, ip) {
  if (!allowed(ip)) throw Object.assign(new Error('Too many tries. Wait 15 minutes and try again.'), { status: 429 });
  let base;
  try { base = parseEventsUrl(input); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
  const username = new URL(base).pathname.split('/').filter(Boolean)[1];
  const r = await q(
    `select id, cb_token_enc from performers where lower(cb_username)=lower($1) and approved and cb_token_enc is not null`, [username]);
  const p = r.rows[0];
  const saved = p ? decrypt(p.cb_token_enc, config.tokenKey) : '';
  if (!p || !same(saved, base)) {
    throw Object.assign(new Error("That link doesn't match a StreamWing room. Copy the long link on the row named StreamWing, under Events API (public)."), { status: 400 });
  }
  const key = newAccessKey();
  await q(`update performers set access_key_hash=$2 where id=$1`, [p.id, hashKey(key)]);
  return { link: `https://streamwing.studio/connect/#k=${key}` };
}
