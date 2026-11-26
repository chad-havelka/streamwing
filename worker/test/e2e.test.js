// End-to-end: fake Chaturbate -> worker -> database -> panel API. Two streams, a day apart.
// Needs TEST_DATABASE_URL pointing at an empty throwaway Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSim } from './sim-server.js';

const DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB;
process.env.DB_SSL = 'false';
process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
process.env.PORT = '8799';
process.env.ALLOW_HTTP_EVENTS = '1';
process.env.POLL_TIMEOUT_SEC = '1';

let sim, q, pool, server, timer, key;
const API = 'http://127.0.0.1:8799';
const call = (path, opts = {}) => fetch(API + path, { ...opts, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(opts.headers || {}) } })
  .then(async r => ({ status: r.status, body: await r.json() }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function settle() { await wait(1800); }
const kinds = async () => (await call('/api/feed?limit=100')).body.items.map(i => `${i.kind}${i.username ? ':' + i.username : ''}`).reverse();

before(async () => {
  ({ q, pool } = await import('../src/db.js'));
  await q('drop schema public cascade; create schema public;');
  const { migrate } = await import('../src/migrate.js');
  await migrate();
  const { newAccessKey, hashKey } = await import('../src/crypto.js');
  key = newAccessKey();
  await q(`insert into performers (cb_username, display_name, access_key_hash) values ('sim_room','Sim',$1)`, [hashKey(key)]);
  sim = await createSim();
  const { startHttp } = await import('../src/http.js');
  const { startSupervisor } = await import('../src/poller.js');
  server = startHttp();
  timer = startSupervisor();
  await wait(300);
});

after(async () => { clearInterval(timer); server.close(); sim.close(); setTimeout(() => process.exit(0), 200); });

test('bad link and bad key are refused', async () => {
  const r = await fetch(API + '/api/me', { headers: { authorization: 'Bearer nope-nope-nope-nope-nope' } });
  assert.equal(r.status, 401);
  const wrongUser = await call('/api/connect', { method: 'POST', body: JSON.stringify({ eventsUrl: sim.eventsUrl.replace('sim_room', 'someone_else') }) });
  assert.equal(wrongUser.status, 400);
  assert.match(wrongUser.body.error, /not sim_room/);
  const wrongToken = await call('/api/connect', { method: 'POST', body: JSON.stringify({ eventsUrl: sim.eventsUrl.replace('simtoken123', 'badtoken') }) });
  assert.equal(wrongToken.status, 400);
});

test('connect, then stream 1: grays, light blues, a conversion, a recap', async () => {
  const c = await call('/api/connect', { method: 'POST', body: JSON.stringify({ eventsUrl: sim.eventsUrl }) });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const enc = (await q(`select cb_token_enc from performers`)).rows[0].cb_token_enc;
  assert.ok(!enc.includes('simtoken123'), 'token must be encrypted at rest');

  const { ev, user } = sim;
  const luna = user('luna_92', { colorGroup: 'lightblue', hasTokens: true, recentTips: 'few' });
  const mike = user('mike_t');
  const dave = user('dave_r', { colorGroup: 'lightblue', hasTokens: true, recentTips: 'few' });
  sim.push([
    ev('broadcastStart', { user: user('sim_room', { isOwner: true }) }),
    ev('userEnter', { user: luna }),
    ev('userEnter', { user: mike }),
    ev('chatMessage', { user: luna, message: { message: 'hiii first time here', color: '', font: '' } }),
    ev('tip', { user: luna, tip: { tokens: 25, isAnon: false, message: 'for you' } }),
    ev('follow', { user: mike }),
    ev('userEnter', { user: dave }),
    ev('userLeave', { user: dave }),
    ev('chatMessage', { user: user('sim_room', { isOwner: true }), message: { message: 'thanks luna!' } }),
    ev('broadcastStop', { user: user('sim_room', { isOwner: true }) }),
  ]);
  await settle();

  assert.deepEqual(await kinds(), ['live', 'new_with_tokens:luna_92', 'new_viewer:mike_t', 'first_tip:luna_92', 'follow:mike_t', 'new_with_tokens:dave_r', 'recap']);
  const recap = (await call('/api/feed?limit=1')).body.items[0].data;
  assert.equal(recap.tokens, 25);
  assert.equal(recap.tippers, 1);
  assert.equal(recap.uniqueVisitors, 3);
  assert.equal(recap.lightBluesSeen, 2);
  assert.equal(recap.lightBluesConverted, 1);
  assert.deepEqual(recap.convertedFans, ['luna_92']);
  assert.deepEqual(recap.lightBluesNotYet, ['dave_r']);
  assert.equal(recap.newFollowers, 1);

  const lunaCard = (await call('/api/fans/luna_92')).body;
  assert.equal(lunaCard.total_tips, 25);
  assert.equal(lunaCard.last_message, 'hiii first time here');
  assert.equal(lunaCard.visits, 1);
  // The performer's own chat never becomes a fan.
  assert.equal((await call('/api/fans/sim_room')).status, 404);
});

test('stream 2, next day: she sees who is back and who they are', async () => {
  // Pretend stream 1 was yesterday.
  await q(`update fans set last_seen = now() - interval '1 day', last_visit_day = current_date - 1`);
  const { ev, user } = sim;
  const luna = user('luna_92', { colorGroup: 'darkblue', hasTokens: true, recentTips: 'some' });
  const dave = user('dave_r', { colorGroup: 'lightblue', hasTokens: true, recentTips: 'few' });
  const kat = user('kat_x', { colorGroup: 'lightblue', hasTokens: true });
  sim.push([
    ev('broadcastStart', { user: user('sim_room', { isOwner: true }) }),
    ev('userEnter', { user: luna }),
    ev('userEnter', { user: dave }),
    ev('userEnter', { user: user('mike_t') }),
    ev('userEnter', { user: kat }),
    ev('tip', { user: luna, tip: { tokens: 100, isAnon: false, message: '' } }),
    ev('userLeave', { user: luna }),
    ev('userEnter', { user: luna }), // quick re-entry: no second callout
    ev('tip', { user: dave, tip: { tokens: 10, isAnon: false, message: 'hi' } }),
  ]);
  await settle();

  const k = await kinds();
  const s2 = k.slice(k.lastIndexOf('live'));
  assert.deepEqual(s2, ['live', 'tipper_back:luna_92', 'light_blue_back:dave_r', 'returning:mike_t', 'new_with_tokens:kat_x', 'tip:luna_92', 'first_tip:dave_r']);

  const me = (await call('/api/me')).body;
  assert.equal(me.live, true);
  assert.equal(me.session.tokens, 110);
  assert.equal(me.session.light_blues_converted, 1);
  assert.equal(me.session.returning_visitors, 3);

  const room = (await call('/api/room')).body.fans.map(f => f.username);
  assert.equal(room[0], 'luna_92', 'biggest tipper first');
  assert.equal(room.length, 4);

  const luna2 = (await call('/api/fans/luna_92')).body;
  assert.equal(luna2.total_tips, 125);
  assert.equal(luna2.visit_days, 2);
  assert.equal(luna2.visits, 2);
});

test('worker restart resumes from the saved cursor without double counting', async () => {
  const before = (await q(`select count(*)::int n from events`)).rows[0].n;
  const { stopLoop, startLoop } = await import('../src/poller.js');
  const pid = (await q(`select id from performers`)).rows[0].id;
  stopLoop(pid); await wait(1500);
  await q(`update performers set next_url_enc = null`); // worst case: cursor lost, replay from start
  startLoop(pid); await settle();
  const afterCount = (await q(`select count(*)::int n from events`)).rows[0].n;
  assert.equal(afterCount, before, 'replayed events are ignored');
  const luna = (await call('/api/fans/luna_92')).body;
  assert.equal(luna.total_tips, 125);
});

test('disconnect with delete wipes her data', async () => {
  const r = await call('/api/disconnect', { method: 'POST', body: JSON.stringify({ deleteData: true }) });
  assert.equal(r.status, 200);
  for (const t of ['fans', 'events', 'feed', 'sessions']) assert.equal((await q(`select count(*)::int n from ${t}`)).rows[0].n, 0, t);
  const p = (await q(`select cb_token_enc from performers`)).rows[0];
  assert.equal(p.cb_token_enc, null);
});

test('a bare token is turned into her Events API link', async () => {
  const { parseEventsUrl } = await import('../src/cb.js');
  assert.equal(parseEventsUrl('  AbC123xyz456  ', 'Jhessi_kissie'), 'https://eventsapi.chaturbate.com/events/Jhessi_kissie/AbC123xyz456/');
  assert.equal(parseEventsUrl('https://eventsapi.chaturbate.com/events/Jhessi_kissie/AbC123xyz456/?timeout=10', 'Jhessi_kissie'), 'https://eventsapi.chaturbate.com/events/Jhessi_kissie/AbC123xyz456/');
  assert.throws(() => parseEventsUrl('short', 'Jhessi_kissie'));
});

test('the token page link, in any shape Chaturbate shows it, becomes her Events API link', async () => {
  const { parseEventsUrl } = await import('../src/cb.js');
  const want = 'https://eventsapi.chaturbate.com/events/Jhessi_kissie/AbC123xyz456/';
  assert.equal(parseEventsUrl('https://chaturbate.com/statsapi/?username=Jhessi_kissie&token=AbC123xyz456', 'Jhessi_kissie'), want);
  assert.throws(() => parseEventsUrl('https://chaturbate.com/statsapi/?username=someone&token=AbC123xyz456', 'Jhessi_kissie'), /not Jhessi_kissie/);
  assert.throws(() => parseEventsUrl('https://chaturbate.com/statsapi/authtoken/', 'Jhessi_kissie'), /Generate auth token/);
});
