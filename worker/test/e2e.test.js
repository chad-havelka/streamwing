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
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8797';

// A stand-in for Claude's Messages API that records what StreamWing sends.
import http from 'node:http';
const aiCalls = [];
const aiServer = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const body = JSON.parse(b);
  aiCalls.push({ path: req.url, headers: req.headers, body });
  const facts = JSON.parse(body.messages[0].content);
  const text = facts.fan === 'luna_92' ? '"Asked how your trip was; tipped 25 on her first visit."' : 'SKIP';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text }] }));
}).listen(8797);

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
  await q(`insert into performers (cb_username, display_name, access_key_hash, ai_notes) values ('sim_room','Sim',$1, true)`, [hashKey(key)]);
  sim = await createSim();
  const { startHttp } = await import('../src/http.js');
  const { startSupervisor } = await import('../src/poller.js');
  server = startHttp();
  timer = startSupervisor();
  await wait(300);
});

after(async () => { aiServer.close(); clearInterval(timer); server.close(); sim.close(); /* Let the test runner report failures; CI closes lingering handles. */ });

test('bad link and bad key are refused', async () => {
  const r = await fetch(API + '/api/me', { headers: { authorization: 'Bearer nope-nope-nope-nope-nope' } });
  assert.equal(r.status, 401);
  await q(`update performers set approved=false`);
  assert.equal((await call('/api/me')).status, 401, 'an unapproved account is locked out');
  await q(`update performers set approved=true`);
  assert.equal((await call('/api/me')).status, 200);
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
    ev('privateMessage', { user: luna, message: { message: 'secret pm text', fromUser: 'luna_92', toUser: 'sim_room' } }),
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
  // Private message text is never stored.
  const pm = (await q(`select payload::text p from events where method='privateMessage'`)).rows;
  assert.equal(pm.length, 1);
  assert.ok(!pm[0].p.includes('secret pm text'));
  // The performer's own chat never becomes a fan.
  assert.equal((await call('/api/fans/sim_room')).status, 404);
});

test('after the stream, Claude writes a one-line note for fans who chatted or tipped', async () => {
  await wait(1500);
  assert.equal(aiCalls.length, 1, 'only luna chatted or tipped in stream 1');
  const call0 = aiCalls[0];
  assert.equal(call0.path, '/v1/messages');
  assert.equal(call0.headers['x-api-key'], 'test-key');
  assert.equal(call0.headers['anthropic-version'], '2026-10-21');
  assert.equal(call0.body.model, 'claude-haiku-5-5');
  const sent = call0.body.messages[0].content;
  assert.match(sent, /hiii first time here/, 'her public chat is used');
  assert.doesNotMatch(sent, /secret pm text/, 'private messages are never sent');
  const luna = (await call('/api/fans/luna_92')).body;
  assert.equal(luna.note, 'Asked how your trip was; tipped 25 on her first visit.', 'quotes stripped');
  assert.ok(luna.note_at);
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
  assert.equal(me.session.light_blues_seen, 2, 'dave and kat are light blue; luna already tipped, so she is not');

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
  const { decrypt } = await import('../src/crypto.js');
  const { config } = await import('../src/config.js');
  const savedCursor = (await q(`select next_url_enc from performers`)).rows[0].next_url_enc;
  assert.ok(savedCursor, 'the cursor is saved while she streams');
  assert.match(decrypt(savedCursor, config.tokenKey), /[?&]i=[1-9]\d*/, 'and it has moved past the start');
  stopLoop(pid); await wait(1500);
  await q(`update performers set next_url_enc = null`); // worst case: cursor lost, replay from start
  startLoop(pid); await settle();
  const afterCount = (await q(`select count(*)::int n from events`)).rows[0].n;
  assert.equal(afterCount, before, 'replayed events are ignored');
  const luna = (await call('/api/fans/luna_92')).body;
  assert.equal(luna.total_tips, 125);
});

test('fan profile: last 5 things said, tips, streams, and her private note', async () => {
  const { ev, user } = sim;
  const luna = user('luna_92', { hasTokens: true });
  sim.push(['one', 'two', 'three', 'four', 'five', 'six'].map(m => ev('chatMessage', { user: luna, message: { message: m } })));
  await settle();
  let prof = (await call('/api/fans/luna_92')).body;
  assert.deepEqual(prof.recent_messages.map(x => x.m), ['six', 'five', 'four', 'three', 'two']);
  assert.deepEqual(prof.tips.map(t => t.tokens), [100, 25]);
  assert.equal(prof.streams_attended, 2);
  const saved = await call('/api/fans/luna_92/note', { method: 'POST', body: JSON.stringify({ note: '  Birthday in March. Loves the cat.  ' }) });
  assert.equal(saved.status, 200);
  prof = (await call('/api/fans/luna_92')).body;
  assert.equal(prof.owner_note, 'Birthday in March. Loves the cat.');
  await call('/api/fans/luna_92/note', { method: 'POST', body: JSON.stringify({ note: '' }) });
  assert.equal((await call('/api/fans/luna_92')).body.owner_note, null);
  assert.equal((await call('/api/fans/nobody_here/note', { method: 'POST', body: JSON.stringify({ note: 'x' }) })).status, 404);
  const list = (await call('/api/fans?q=LU')).body.fans.map(f => f.username);
  assert.deepEqual(list, ['luna_92']);
  const all = (await call('/api/fans')).body.fans.map(f => f.username);
  assert.equal(all[0], 'luna_92', 'biggest tipper first');
});

test('stream history: each recap compares with the stream before it', async () => {
  const { ev, user } = sim;
  sim.push([ev('broadcastStop', { user: user('sim_room', { isOwner: true }) })]);
  await settle();
  const recap = (await call('/api/feed?limit=1')).body.items[0];
  assert.equal(recap.kind, 'recap');
  assert.equal(recap.data.tokens, 110);
  assert.equal(recap.data.previous.tokens, 25);
  assert.equal(recap.data.previous.uniqueVisitors, 3);
  await wait(1500);
  const daveAsked = aiCalls.find(c => JSON.parse(c.body.messages[0].content).fan === 'dave_r');
  assert.ok(daveAsked, 'dave tipped in stream 2, so Claude was asked about him');
  assert.equal((await call('/api/fans/dave_r')).body.note, null, 'when Claude says SKIP, no note is saved');
  const sessions = (await call('/api/sessions')).body.sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].tokens, 110);
  assert.equal(sessions[1].tokens, 25);
});

test('daily brief: a birthday on the day, a streak from stream dates, and bad birthdays refused', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  await call('/api/settings', { method: 'POST', body: JSON.stringify({ timezone: 'America/Chicago' }) });
  assert.equal((await call('/api/fans/dave_r/birthday', { method: 'POST', body: JSON.stringify({ birthday: 'not a date' }) })).status, 400);
  assert.equal((await call('/api/fans/dave_r/birthday', { method: 'POST', body: JSON.stringify({ birthday: today }) })).status, 200);
  const b = (await call('/api/brief')).body;
  assert.equal(b.timezone, 'America/Chicago', JSON.stringify(b));
  assert.equal(b.day, today);
  assert.ok(b.items.some(i => i.kind === 'birthday' && i.username === 'dave_r'), 'dave_r has a birthday today');
  assert.ok(b.streak >= 1, 'streaming today counts as a day');
  assert.ok(!JSON.stringify(b).includes('"m"'), 'no chat text in the brief');
  await call('/api/fans/dave_r/birthday', { method: 'POST', body: JSON.stringify({ birthday: '' }) });
  assert.ok(!(await call('/api/brief')).body.items.some(i => i.kind === 'birthday'), 'clearing the birthday removes it');
});

test('growth: finished streams in order, with a chat count per stream and no chat text', async () => {
  const g = (await call('/api/growth')).body;
  assert.equal(g.streams.length, 2, 'two finished streams');
  assert.equal(g.streams[0].tokens, 25, 'oldest first');
  assert.equal(g.streams[1].tokens, 110);
  assert.equal(typeof g.streams[1].messages, 'number', 'each stream carries a chat count');
  assert.equal(g.recent.n, 2);
  assert.equal(g.previous.n, 0, 'nothing before the last five to compare with');
  assert.ok(!JSON.stringify(g).includes('"m"'), 'no chat text in the growth data');
  assert.equal((await call('/api/settings', { method: 'POST', body: JSON.stringify({ timezone: 'America/Chicago' }) })).body.timezone, 'America/Chicago');
  assert.equal((await call('/api/settings', { method: 'POST', body: JSON.stringify({ timezone: 'Not/AZone' }) })).status, 400, 'bad time zone is refused');
});

test('slipping away: tippers and regulars who missed her last 3 streams', async () => {
  const { ev, user } = sim;
  const owner = user('sim_room', { isOwner: true });
  assert.deepEqual((await call('/api/slipping')).body.fans, []);
  for (let i = 0; i < 3; i++) {
    await wait(50);
    sim.push([ev('broadcastStart', { user: owner }), ev('userEnter', { user: user('kat_x', { hasTokens: true }) }), ev('broadcastStop', { user: owner })]);
    await settle();
    if (i < 2) assert.deepEqual((await call('/api/slipping')).body.fans, [], `only ${i + 1} stream missed so far, not slipping yet`);
  }
  const slipping = (await call('/api/slipping')).body.fans;
  assert.deepEqual(slipping.map(f => f.username), ['luna_92', 'dave_r'], 'tippers who stopped coming, biggest first');
  assert.equal(slipping[0].missed_streams, 3);
  assert.ok(!slipping.some(f => f.username === 'kat_x'), 'someone still coming is not slipping');
});

test('her own activity is ignored even when Chaturbate sends no owner flag', async () => {
  const { ev, user } = sim;
  const owner = user('sim_room');          // no isOwner: Chaturbate's documented fields do not include one
  const shout = user('SIM_ROOM');          // letter case must not matter
  sim.push([
    ev('broadcastStart', { user: owner }),
    ev('userEnter', { user: owner }),
    ev('chatMessage', { user: shout, message: { message: 'welcome everyone' } }),
    ev('tip', { user: owner, tip: { tokens: 500, isAnon: false, message: '' } }),
  ]);
  await settle();
  assert.equal((await call('/api/fans/sim_room')).status, 404, 'she never becomes one of her own fans');
  assert.ok(!(await call('/api/fans')).body.fans.some(f => f.username.toLowerCase() === 'sim_room'));
  assert.equal((await call('/api/me')).body.session.tokens, 0, 'her own tip is not income');
});

test('a first tip from someone who was not light blue is not a conversion', async () => {
  const { ev, user } = sim;
  const gary = user('gary_gray');
  sim.push([ev('userEnter', { user: gary }), ev('tip', { user: gary, tip: { tokens: 50, isAnon: false, message: '' } })]);
  await settle();
  const item = (await call('/api/feed?limit=5')).body.items.find(i => i.kind === 'first_tip' && i.username === 'gary_gray');
  assert.ok(item, 'it is still a first tip');
  assert.equal(item.data.converted, false);
  const me = (await call('/api/me')).body;
  assert.equal(me.session.tokens, 50);
  assert.equal(me.session.light_blues_converted, 0);
});

test('coming back later the same day is another visit but not another day', async () => {
  const { ev, user } = sim;
  const before = (await call('/api/fans/kat_x')).body;
  await q(`update fans set last_seen = now() - interval '2 hours' where username = 'kat_x'`);
  sim.push([ev('userEnter', { user: user('kat_x', { hasTokens: true }) }), ev('broadcastStop', { user: user('sim_room') })]);
  await settle();
  const after = (await call('/api/fans/kat_x')).body;
  assert.equal(after.visits, before.visits + 1);
  assert.equal(after.visit_days, before.visit_days);
  const recap = (await call('/api/feed?limit=1')).body.items[0];
  assert.equal(recap.kind, 'recap');
  assert.equal(recap.data.tokens, 50);
  assert.equal(recap.data.lightBluesConverted, 0);
});

test('media, fan club, unfollows, leaving and repeat tips are all counted properly', async () => {
  const { ev, user } = sim;
  const owner = user('sim_room');
  const ann = user('ann_a', { hasTokens: true }), bob = user('bob_b');
  // Chaturbate's documented user fields have no follower flag, so cy's events carry none either.
  const { isFollower: _omit, ...cy } = user('cy_c');
  sim.push([
    ev('broadcastStart', { user: owner }),
    ev('userEnter', { user: ann }), ev('userEnter', { user: bob }), ev('userEnter', { user: cy }),
    ev('chatMessage', { user: bob, message: { message: 'love this room' } }),
    ev('chatMessage', { user: bob, message: { message: 'x'.repeat(600) } }),
    ev('mediaPurchase', { user: ann, media: { name: 'beach set', tokens: 30, type: 'photos' } }),
    ev('fanclubJoin', { user: bob }),
    ev('follow', { user: cy }), ev('unfollow', { user: cy }),
    ev('userLeave', { user: cy }),
    ev('tip', { user: ann, tip: { tokens: 10, isAnon: false, message: '' } }),
    ev('tip', { user: ann, tip: { tokens: 10, isAnon: false, message: '' } }),
  ]);
  await settle();
  const me = (await call('/api/me')).body;
  assert.equal(me.session.tokens, 50, '30 for the media plus two 10 tips');
  assert.equal(me.session.tippers, 1, 'two tips from one fan is one tipper');
  assert.equal(me.session.fanclub_joins, 1);
  assert.equal((await call('/api/fans/bob_b')).body.in_fanclub, true);
  assert.equal((await call('/api/fans/bob_b')).body.last_message.length, 500, 'very long chat lines are cut at 500 characters');
  const rawChat = (await q(`select payload::text p from events where method='chatMessage' and username='bob_b'`)).rows.map(r => r.p).join(' ');
  assert.ok(rawChat.includes('[not stored]') && !rawChat.includes('love this room'), 'chat events are logged without their words');
  assert.equal((await call('/api/fans/cy_c')).body.is_follower, false, 'followed, then unfollowed');
  assert.deepEqual((await call('/api/room')).body.fans.map(f => f.username).sort(), ['ann_a', 'bob_b'], 'cy left the room');
  const k = await kinds();
  for (const want of ['media:ann_a', 'fanclub:bob_b', 'first_tip:ann_a', 'tip:ann_a']) assert.ok(k.includes(want), want);
  sim.push([ev('broadcastStop', { user: owner })]);
  await settle();
  const recap = (await call('/api/feed?limit=1')).body.items[0].data;
  assert.equal(recap.peakInRoom, 3);
  assert.equal(recap.fanclubJoins, 1);
  assert.deepEqual(recap.topTippers.map(t => [t.username, Number(t.tipped)]), [['ann_a', 20]]);
});

test('Claude notes need the key and her switch, and respect the per-stream cap', async () => {
  await wait(1500); // let the notes for the stream that just ended finish
  const { config } = await import('../src/config.js');
  const { writeNotesForSession } = await import('../src/ai.js');
  const pid = (await q(`select id from performers where cb_username='sim_room'`)).rows[0].id;
  const sid = (await q(`select s.id from sessions s join session_fans sf on sf.session_id = s.id where sf.username = 'ann_a' and s.performer_id = $1`, [pid])).rows[0].id;
  const base = aiCalls.length;
  config.aiKey = '';
  try { assert.deepEqual(await writeNotesForSession(pid, sid), { skipped: 'no key' }); } finally { config.aiKey = 'test-key'; }
  assert.equal(aiCalls.length, base, 'no key, no calls to Claude');
  // Her switch is off by default: no calls even with a key.
  await q(`update performers set ai_notes=false where id=$1`, [pid]);
  assert.deepEqual(await writeNotesForSession(pid, sid), { skipped: 'off' });
  assert.equal(aiCalls.length, base, 'switch off, no calls to Claude');
  await q(`update performers set ai_notes=true where id=$1`, [pid]);
  config.aiNotesPerStream = 1;
  try { await writeNotesForSession(pid, sid); } finally { config.aiNotesPerStream = 40; }
  assert.equal(aiCalls.length, base + 1, 'capped at one fan');
  await writeNotesForSession(pid, sid);
  assert.equal(aiCalls.length, base + 3, 'ann tipped and bob chatted, so both are asked about');
  // The panel's switch goes through the route and shows on /api/me.
  assert.equal((await call('/api/ai-notes', { method: 'POST', body: JSON.stringify({ on: false }) })).body.aiNotes, false);
  assert.equal((await call('/api/me')).body.aiNotes, false);
  assert.equal((await call('/api/ai-notes', { method: 'POST', body: JSON.stringify({ on: true }) })).body.aiNotes, true);
  assert.equal((await call('/api/me')).body.aiNotes, true);
});

test('callout rules: every kind, at its boundary', async () => {
  const { enterCallout, isLightBlue } = await import('../src/brain.js');
  const fan = o => ({ total_tips: 0, visit_days: 1, has_tokens: false, ...o });
  assert.equal(enterCallout(null, fan({}), true), 'new_viewer');
  assert.equal(enterCallout(null, fan({ has_tokens: true }), true), 'new_with_tokens');
  assert.equal(enterCallout({}, fan({ total_tips: 1 }), false), 'tipper_back');
  assert.equal(enterCallout({}, fan({ total_tips: 99 }), false), 'tipper_back');
  assert.equal(enterCallout({}, fan({ total_tips: 100 }), false), 'big_tipper_back');
  assert.equal(enterCallout({}, fan({ visit_days: 2 }), false), 'returning');
  assert.equal(enterCallout({}, fan({ visit_days: 3 }), false), 'regular_back');
  assert.equal(enterCallout({}, fan({ has_tokens: true }), false), 'light_blue_back');
  assert.equal(enterCallout({}, fan({ has_tokens: true, visit_days: 3 }), false), 'regular_back', 'a regular beats light blue');
  assert.equal(isLightBlue(fan({ has_tokens: true })), true);
  assert.equal(isLightBlue(fan({ has_tokens: true, total_tips: 5 })), false, 'tipping makes them not light blue');
  assert.equal(isLightBlue(fan({ has_tokens: false })), false);
  assert.equal(isLightBlue(fan({ has_tokens: null })), false, 'unknown is not light blue');
});

test('the panel on streamwing.studio may call the API; other sites may not', async () => {
  const ok = await fetch(API + '/api/me', { headers: { origin: 'https://streamwing.studio', authorization: `Bearer ${key}` } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://streamwing.studio');
  const pre = await fetch(API + '/api/connect', { method: 'OPTIONS', headers: { origin: 'https://streamwing.studio', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const bad = await fetch(API + '/api/me', { headers: { origin: 'https://evil.example', authorization: `Bearer ${key}` } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('live updates reach an open panel, and only the right performer\'s', async () => {
  const ctl = new AbortController();
  const res = await fetch(`${API}/api/stream?k=${key}`, { signal: ctl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const { ev, user } = sim;
  sim.push([ev('broadcastStart', { user: user('sim_room') }), ev('userEnter', { user: user('sse_sam') })]);
  let got = '';
  const reader = res.body.getReader();
  const until = Date.now() + 6000;
  while (Date.now() < until && !/sse_sam/.test(got)) {
    const r = await Promise.race([reader.read(), wait(1500).then(() => ({ timeout: true }))]);
    if (r.done) break;
    if (r.value) got += Buffer.from(r.value).toString();
  }
  ctl.abort();
  assert.match(got, /"kind":"new_viewer"/);
  assert.match(got, /sse_sam/);
  const none = await fetch(`${API}/api/stream?k=wrong-wrong-wrong-wrong-wrong`);
  assert.equal(none.status, 401);
  sim.push([ev('broadcastStop', { user: user('sim_room') })]);
  await settle();
});

test('a saved place that Chaturbate says is too old is replaced, not retried forever', async () => {
  // Captured behaviour from events.testbed.cb.dev: HTTP 400, {"status":"You waited too long...","nextUrl":"..."}
  const { stopLoop, startLoop } = await import('../src/poller.js');
  const { encrypt } = await import('../src/crypto.js');
  const { config } = await import('../src/config.js');
  const { ev, user } = sim;
  const pid = (await q(`select id from performers where cb_username='sim_room'`)).rows[0].id;
  stopLoop(pid); await wait(1500);
  await q(`update performers set next_url_enc=$2 where id=$1`, [pid, encrypt(`${sim.eventsUrl}?i=stale`, config.tokenKey)]);
  startLoop(pid);
  await wait(500);
  sim.push([ev('broadcastStart', { user: user('sim_room') }), ev('userEnter', { user: user('after_gap_gus') }), ev('broadcastStop', { user: user('sim_room') })]);
  await settle();
  assert.equal((await call('/api/fans/after_gap_gus')).status, 200, 'events after the gap are received');
  const me = (await call('/api/me')).body;
  assert.equal(me.lastError, null, 'no error left behind');
});

test('a real session captured from the Chaturbate testbed (Nov 2026) is understood end to end', async () => {
  // Every event below is what events.testbed.cb.dev actually sent for a second account (streamwingtester)
  // in quietquotient's room: unfollow, follow, chat, an anonymous tip, a normal tip, unfollow, leave, re-enter.
  // We connected after the viewer was already in the room, so the first thing seen is not an "enter".
  const RU = o => ({ isMod: false, gender: 'm', isOwner: false, isSpying: false, language: 'en', username: 'streamwingtester',
    hasTokens: true, inFanclub: false, subgender: '', colorGroup: 't', isFollower: false, isSilenced: false, recentTips: 'few',
    fcAutoRenew: false, hasDarkmode: false, inPrivateShow: false, isBroadcasting: true, ...o });
  const TR = { colorGroup: 'tr', recentTips: 'some' };
  const E = (id, method, user, extra = {}) => ({ method, id, object: { broadcaster: 'sim_room', user, ...extra } });
  // Connect now, mid-stream, so the first thing on the new connection is viewer activity.
  assert.equal((await call('/api/connect', { method: 'POST', body: JSON.stringify({ eventsUrl: sim.eventsUrl }) })).status, 200);
  sim.push([
    E('1795666146613-0', 'unfollow', RU({})),
    E('1795666149785-0', 'follow', RU({ isFollower: true })),
    E('1795666165533-0', 'chatMessage', RU({ isFollower: true }), { message: { font: 'default', orig: null, color: '', bgColor: null, message: 'hello from the test' } }),
    E('1795666179616-0', 'tip', RU({ isFollower: true }), { tip: { isAnon: true, tokens: 10, message: 'anon tip' } }),
    E('1795666190905-0', 'tip', RU({ isFollower: true, ...TR }), { tip: { isAnon: false, tokens: 25, message: 'test' } }),
    E('1795666209037-0', 'unfollow', RU({ ...TR })),
    E('1795666216659-0', 'userLeave', RU({ ...TR })),
    E('1795666228164-0', 'userEnter', RU({ ...TR })),
  ]);
  await settle();
  const me = (await call('/api/me')).body;
  assert.equal(me.session.tokens, 35, 'the anonymous 10 counts, plus the 25');
  assert.equal(me.session.tippers, 1);
  assert.equal(me.session.unique_visitors, 1);
  assert.equal(me.session.new_visitors, 1);
  const fan = (await call('/api/fans/streamwingtester')).body;
  assert.equal(fan.total_tips, 35);
  assert.equal(fan.tip_count, 2);
  assert.equal(fan.biggest_tip, 25);
  assert.equal(fan.last_message, 'hello from the test');
  assert.equal(fan.is_follower, false, 'followed, then unfollowed');
  assert.equal(fan.color_group, 'tr');
  assert.equal(fan.recent_tips, 'some');
  const items = (await call('/api/feed?limit=100')).body.items.filter(i => i.username === 'streamwingtester').reverse();
  assert.deepEqual(items.map(i => i.kind), ['follow', 'first_tip', 'tip'],
    'no "new viewer" card after someone who was already in the room has tipped');
  assert.equal(items[1].data.isAnon, true, 'the anonymous tip is marked anonymous');
  sim.push([sim.ev('broadcastStop', { user: sim.user('sim_room') })]);
  await settle();
});

test('a leave, chat or tip that arrives after she stopped does not open a phantom stream', async () => {
  // Real testbed behaviour: a lone userLeave from streamwingtester arrived with no stream running.
  // Chat and tips can arrive after broadcastStop the same way.
  const { ev, user } = sim;
  const streams = async () => {
    const r = await call('/api/sessions');
    assert.equal(r.status, 200, 'the stream list endpoint answers');
    assert.ok(Array.isArray(r.body.sessions) && r.body.sessions.length > 0, 'her past streams are listed');
    return r.body.sessions.map(s => s.id);
  };
  const streamCount = async () => (await q(`select count(*)::int n from sessions s join performers p on p.id = s.performer_id where p.cb_username = 'sim_room'`)).rows[0].n;
  const streamsBefore = await streams();
  const countBefore = await streamCount();
  assert.equal((await call('/api/me')).body.live, false, 'she has stopped');
  const tipsBefore = Number((await call('/api/fans/streamwingtester')).body.total_tips);
  const late = [
    ['a lone leave', ev('userLeave', { user: user('late_leaver') })],
    ['a late chat', ev('chatMessage', { user: user('late_lucy'), message: { message: 'bye!' } })],
    ['a late tip', ev('tip', { user: user('streamwingtester', { colorGroup: 'tr', hasTokens: true, recentTips: 'some' }), tip: { isAnon: false, tokens: 15, message: 'gn' } })],
  ];
  for (const [what, e] of late) {
    sim.push([e]);
    await settle();
    assert.deepEqual(await streams(), streamsBefore, `no new stream from ${what}`);
    assert.equal(await streamCount(), countBefore, `no new stream row from ${what}`);
    assert.equal((await call('/api/me')).body.live, false, `still offline after ${what}`);
  }
  assert.equal((await call('/api/fans/late_leaver')).status, 404, 'no fan row from a lone leave');
  const live = (await q(`select count(*)::int n from sessions where ended_at is null`)).rows[0].n;
  assert.equal(live, 0, 'nothing left open');
  assert.equal(Number((await call('/api/fans/streamwingtester')).body.total_tips), tipsBefore + 15, 'a late tip still counts toward what the fan has given');
});

test('a link that does not go to Chaturbate is refused, and a feed cannot send us to another host', async () => {
  const { parseEventsUrl, isChaturbateHost, sameHost } = await import('../src/cb.js');
  const saved = process.env.ALLOW_HTTP_EVENTS; delete process.env.ALLOW_HTTP_EVENTS;
  try {
    for (const bad of ['https://evil.example.com/events/jhessi_kissie/abcdefgh12345/', 'https://169.254.169.254/events/jhessi_kissie/abcdefgh12345/', 'https://eventsapi.chaturbate.com.evil.io/events/jhessi_kissie/abcdefgh12345/', 'http://eventsapi.chaturbate.com/events/jhessi_kissie/abcdefgh12345/'])
      assert.throws(() => parseEventsUrl(bad, 'jhessi_kissie'), undefined, bad);
    assert.ok(parseEventsUrl('https://eventsapi.chaturbate.com/events/jhessi_kissie/abcdefgh12345/', 'jhessi_kissie'));
    assert.ok(parseEventsUrl('https://events.testbed.cb.dev/events/jhessi_kissie/abcdefgh12345/', 'jhessi_kissie'));
    assert.ok(parseEventsUrl('abcdefgh12345', 'jhessi_kissie'), 'bare token still works');
  } finally { if (saved !== undefined) process.env.ALLOW_HTTP_EVENTS = saved; }
  assert.equal(sameHost('https://evil.io/events/x/y/?i=1', 'https://eventsapi.chaturbate.com/events/x/y/'), false);
  assert.equal(sameHost('https://eventsapi.chaturbate.com/events/x/y/?i=1', 'https://eventsapi.chaturbate.com/events/x/y/'), true);
});

let otherId, otherKey;
test("one performer never sees another's fans, feed or streams", async () => {
  const { newAccessKey, hashKey } = await import('../src/crypto.js');
  otherKey = newAccessKey();
  otherId = (await q(`insert into performers (cb_username, display_name, access_key_hash) values ('other_room','Other',$1) returning id`, [hashKey(otherKey)])).rows[0].id;
  await q(`insert into fans (performer_id, username, visits, visit_days, total_tips, tip_count, has_tokens, last_seen) values ($1,'other_whale',9,9,900,3,true, now() - interval '30 days')`, [otherId]);
  for (let i = 0; i < 4; i++) await q(`insert into sessions (performer_id, started_at, ended_at) values ($1, now() - interval '${20 - i} days', now() - interval '${20 - i} days' + interval '1 hour')`, [otherId]);
  await q(`insert into feed (performer_id, kind, username) values ($1,'tip','other_whale')`, [otherId]);
  const mine = await Promise.all(['/api/fans', '/api/fans?q=other', '/api/slipping', '/api/room', '/api/feed?limit=100', '/api/sessions', '/api/me'].map(p => call(p).then(r => JSON.stringify(r.body))));
  for (const body of mine) assert.ok(!/other_whale|other_room/.test(body), 'her views never contain the other performer');
  assert.equal((await call('/api/fans/other_whale')).status, 404);
  assert.equal((await call('/api/fans/other_whale/note', { method: 'POST', body: JSON.stringify({ note: 'x' }) })).status, 404);
  // And the other performer's own key does see theirs: the views are scoped, not just empty.
  const theirs = await fetch(API + '/api/slipping', { headers: { authorization: `Bearer ${otherKey}` } }).then(r => r.json());
  assert.deepEqual(theirs.fans.map(f => f.username), ['other_whale']);
  const theirSessions = await fetch(API + '/api/sessions', { headers: { authorization: `Bearer ${otherKey}` } }).then(r => r.json());
  assert.equal(theirSessions.sessions.length, 4);
});

test("live updates are not shared across performers", async () => {
  const { ev, user } = sim;
  const ctl = new AbortController();
  const res = await fetch(`${API}/api/stream?k=${otherKey}`, { signal: ctl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let got = '';
  const pump = (async () => { try { for (;;) { const r = await reader.read(); if (r.done) break; got += Buffer.from(r.value).toString(); } } catch { /* aborted */ } })();
  sim.push([ev('broadcastStart', { user: user('sim_room') }), ev('userEnter', { user: user('leak_larry') }), ev('broadcastStop', { user: user('sim_room') })]);
  await settle();
  ctl.abort(); await pump;
  assert.match(got, /retry:/, 'the connection itself works');
  assert.doesNotMatch(got, /leak_larry/, "another performer's panel never receives her events");
});

test('disconnect with delete wipes her data and only hers', async () => {
  const r = await call('/api/disconnect', { method: 'POST', body: JSON.stringify({ deleteData: true }) });
  assert.equal(r.status, 200);
  const hers = (await q(`select id from performers where cb_username='sim_room'`)).rows[0].id;
  for (const t of ['fans', 'events', 'feed', 'sessions']) assert.equal((await q(`select count(*)::int n from ${t} where performer_id=$1`, [hers])).rows[0].n, 0, t);
  const p = (await q(`select cb_token_enc from performers where id=$1`, [hers])).rows[0];
  assert.equal(p.cb_token_enc, null);
  assert.equal((await q(`select count(*)::int n from fans where performer_id=$1`, [otherId])).rows[0].n, 1, "the other performer's fans are untouched");
  assert.equal((await q(`select count(*)::int n from sessions where performer_id=$1`, [otherId])).rows[0].n, 4, "and their streams");
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
  assert.throws(() => parseEventsUrl('https://chaturbate.com/statsapi/?username=Jhessi_kissie&token=AbC123xyz456', 'Jhessi_kissie'), /Stats link/);
  assert.throws(() => parseEventsUrl('https://chaturbate.com/statsapi/authtoken/', 'Jhessi_kissie'), /Generate auth token/);
});

test('events shaped exactly like Chaturbate\'s docs (name in `user`) are understood', async () => {
  const { normalizeEvent } = await import('../src/cb.js');
  const e = normalizeEvent({ method: 'tip', id: '1775683684418-0', object: {
    broadcaster: 'Jhessi_kissie',
    user: { user: 'luna_92', inFanclub: false, hasTokens: true, isMod: false, recentTips: 'some', gender: 'm', subgender: '' },
    tip: { tokens: 25, isAnon: false, message: 'hi' } } });
  assert.equal(e.user.username, 'luna_92');
  assert.equal(e.user.hasTokens, true);
  assert.equal(e.user.recentTips, 'some');
  assert.equal(e.tip.tokens, 25);
  assert.equal(e.user.isFollower, null, 'not in the docs, so unknown rather than false');
});

test("Chaturbate's own tip example (docs/methods/tip.html) is understood exactly", async () => {
  const { normalizeEvent } = await import('../src/cb.js');
  const object = {
    broadcaster: 'testuser',
    tip: { tokens: 25, isAnon: false, message: '' },
    user: { username: 'testuser1', inFanclub: false, gender: 'f', hasTokens: true, recentTips: 'some', isMod: false },
  };
  const e = normalizeEvent({ method: 'tip', id: '1775683684418-0', object });
  assert.equal(e.broadcaster, 'testuser');
  assert.equal(e.user.username, 'testuser1');
  assert.equal(e.user.hasTokens, true);
  assert.equal(e.user.inFanclub, false);
  assert.equal(e.tip.tokens, 25);
  assert.equal(e.tip.isAnon, false);
});

test('a network block is not mistaken for a bad token', async () => {
  const { CbError } = await import('../src/cb.js');
  const blocked = new CbError(403, '<!DOCTYPE html><title>Just a moment...</title> cloudflare');
  assert.equal(blocked.auth, false);
  assert.equal(blocked.retryable, true);
  assert.equal(new CbError(401, '{"status":"Unauthorized"}').auth, true);
});

test("an event captured from Chaturbate's own testbed (Nov 2026) is understood", async () => {
  // Real response from events.testbed.cb.dev for an owner entering her own room. Not hand-written.
  const captured = { method: 'userEnter', id: '1795664417157-0', object: { broadcaster: 'quietquotient', user: {
    colorGroup: 'o', fcAutoRenew: false, gender: 'm', hasDarkmode: false, hasTokens: true, inFanclub: false,
    inPrivateShow: false, isBroadcasting: true, isFollower: false, isMod: false, isOwner: true, isSilenced: false,
    isSpying: false, language: 'en', recentTips: 'few', subgender: '', username: 'quietquotient' } } };
  const { normalizeEvent } = await import('../src/cb.js');
  const e = normalizeEvent(captured);
  assert.deepEqual(e.user, { username: 'quietquotient', colorGroup: 'o', hasTokens: true, recentTips: 'few', isFollower: false,
    inFanclub: false, isMod: false, isOwner: true, language: 'en', gender: 'm' });
  assert.equal(e.broadcaster, 'quietquotient');
  assert.equal(e.id, '1795664417157-0');
});

test('a restart link is only followed when it stays on the same feed', async () => {
  const { restartFor } = await import('../src/cb.js');
  const cur = 'https://events.testbed.cb.dev/events/quietquotient/tok123/?i=1-0&timeout=10';
  assert.equal(restartFor('https://events.testbed.cb.dev/events/quietquotient/tok123/?timeout=0', cur), 'https://events.testbed.cb.dev/events/quietquotient/tok123/');
  assert.equal(restartFor('https://evil.example/events/quietquotient/tok123/', cur), null, 'other host');
  assert.equal(restartFor('https://events.testbed.cb.dev/events/someone_else/tok999/', cur), null, 'other feed');
  assert.equal(restartFor('not a url', cur), null);
});

test('the monitor pings when healthy, pings /fail with the reason when a connection has an error, and /health shows which keys are set', async () => {
  const hits = [];
  const mon = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; hits.push({ path: req.url, body: b }); res.end('OK'); }).listen(8796);
  try {
    const { runCheck } = await import('../src/monitor.js');
    await q(`update performers set last_error=null, last_poll_at=now() where cb_username='sim_room'`);
    await runCheck('http://127.0.0.1:8796/abc');
    assert.equal(hits.at(-1).path, '/abc');
    const before = (await q(`select cb_token_enc, approved from performers where cb_username='sim_room'`)).rows[0];
    await q(`update performers set approved=true, cb_token_enc=coalesce(cb_token_enc,'x'), last_error='Chaturbate did not accept the token' where cb_username='sim_room'`);
    await runCheck('http://127.0.0.1:8796/abc');
    assert.equal(hits.at(-1).path, '/abc/fail');
    assert.match(hits.at(-1).body, /sim_room: Chaturbate did not accept the token/);
    assert.ok(!/fan|chat|tip/i.test(hits.at(-1).body.replace(/Chaturbate did not accept the token/, '')), 'only performer names and errors leave the server');
    await q(`update performers set last_error=null, cb_token_enc=$1, approved=$2 where cb_username='sim_room'`, [before.cb_token_enc, before.approved]);
    const h = await (await fetch(API + '/health')).json();
    assert.deepEqual(h, { ok: true, ai: true, keySource: 'explicit', monitor: false });
  } finally { mon.close(); }
});

test('old raw events expire after the retention period, but tips stay', async () => {
  const pid = (await q(`select id from performers where cb_username='sim_room'`)).rows[0].id;
  await q(`insert into events (performer_id, cb_event_id, method, username, payload, received_at) values ($1,'old-follow','follow','x','{}', now() - interval '40 days'), ($1,'old-tip','tip','x','{}', now() - interval '40 days'), ($1,'new-follow','follow','x','{}', now() - interval '5 days')`, [pid]);
  const { purgeOldEvents } = await import('../src/purge.js');
  assert.equal(await purgeOldEvents(0), 0, 'zero turns the purge off');
  await purgeOldEvents(30);
  const left = (await q(`select cb_event_id from events where cb_event_id in ('old-follow','old-tip','new-follow') order by 1`)).rows.map(r => r.cb_event_id);
  assert.deepEqual(left, ['new-follow', 'old-tip']);
});
