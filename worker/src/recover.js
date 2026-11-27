// Lost her private link? She proves she owns the room by pasting the Events API link
// Chaturbate shows her on its token page. If it matches the link saved for that room,
// we issue a new private key. The old key stops working at once. Her history stays.
import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { decrypt, encrypt, hashKey, newAccessKey } from './crypto.js';
import { parseEventsUrl, poll, CbError } from './cb.js';
import { startLoop } from './poller.js';

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
  return { link: `https://streamwing.studio/owl/#k=${key}` };
}

// No account yet? The Events API link proves she owns the room, so the first paste creates
// her account and connects it in one step. No password, no admin command. If the room already
// has a different saved link, we refuse, so a stranger cannot replace her connection.
export async function openAccount(input, ip) {
  if (!allowed(ip)) throw Object.assign(new Error('Too many tries. Wait 15 minutes and try again.'), { status: 429 });
  let base;
  try { base = parseEventsUrl(input); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
  const username = new URL(base).pathname.split('/').filter(Boolean)[1];
  // Chaturbate has to accept the link before we save anything.
  try { await poll(base, 0); } catch (e) {
    if (e instanceof CbError && e.auth) {
      throw Object.assign(new Error("Chaturbate didn't accept that link. The usual cause is a wrong box ticked. Make a new token with only Events API (public) ticked, then copy the link that starts with https://eventsapi.chaturbate.com"), { status: 400 });
    }
    throw Object.assign(new Error("Couldn't reach Chaturbate just now. Try again in a minute."), { status: 502 });
  }
  const r = await q(`select id, cb_token_enc from performers where lower(cb_username)=lower($1)`, [username]);
  const p = r.rows[0];
  if (p && p.cb_token_enc && !same(decrypt(p.cb_token_enc, config.tokenKey), base)) {
    throw Object.assign(new Error('This room already has a StreamWing account. Use your private link, or get a new one from the lost-link page.'), { status: 400 });
  }
  const key = newAccessKey();
  let id;
  if (p) {
    await q(`update performers set access_key_hash=$2, cb_token_enc=$3, next_url_enc=null, connected_at=now(), last_error=null where id=$1`,
      [p.id, hashKey(key), encrypt(base, config.tokenKey)]);
    id = p.id;
  } else {
    const ins = await q(`insert into performers (cb_username, access_key_hash, cb_token_enc, connected_at) values ($1,$2,$3,now()) returning id`,
      [username, hashKey(key), encrypt(base, config.tokenKey)]);
    id = ins.rows[0].id;
  }
  startLoop(id);
  return { link: `https://streamwing.studio/owl/#k=${key}` };
}
