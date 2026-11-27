// Owl evaluation harness. Runs the StreamWing worker against a stand-in for Chaturbate's Events API
// and a throwaway Postgres, with synthetic viewers only. Nothing here touches production.
//
// usage: EVAL_DATABASE_URL=postgres://... node owl-eval.mjs <path to worker folder> <results.json>
//
// Each scenario gets its own room. A scenario states what a streamer would expect, records what the
// worker actually did, and is marked PASS or FAIL. Measurements (speed, delay) are recorded as numbers.
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const workerDir = path.resolve(process.argv[2]);
const outFile = process.argv[3] || 'results.json';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

process.env.DATABASE_URL = process.env.EVAL_DATABASE_URL;
process.env.DB_SSL = 'false';
process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
process.env.PORT = '8811';
process.env.ALLOW_HTTP_EVENTS = '1';
process.env.POLL_TIMEOUT_SEC = '1';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8812';

// Stand-in for the Claude API. Behaviour is switched per scenario.
const ai = { mode: 'ok', calls: [] };
const aiServer = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  ai.calls.push(JSON.parse(b));
  if (ai.mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"type":"error"}'); }
  const text = ai.mode === 'long'
    ? Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ')
    : 'Likes to talk about hiking.';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text }] }));
}).listen(8812);

const imp = f => import(path.join(workerDir, f));
const { q } = await imp('src/db.js');
await q('drop schema public cascade; create schema public;');
await (await imp('src/migrate.js')).migrate();
const { newAccessKey, hashKey } = await imp('src/crypto.js');
const { createSim } = await imp('test/sim-server.js');
const server = (await imp('src/http.js')).startHttp();
const timer = (await imp('src/poller.js')).startSupervisor();

const API = 'http://127.0.0.1:8811';
const wait = ms => new Promise(r => setTimeout(r, ms));
let roomN = 0;

async function newRoom({ aiNotes = false } = {}) {
  const username = `room_${++roomN}`;
  const sim = await createSim({ username, token: 'tok' + crypto.randomBytes(6).toString('hex') });
  const key = newAccessKey();
  const pid = (await q(`insert into performers (cb_username, access_key_hash, ai_notes) values ($1,$2,$3) returning id`,
    [username, hashKey(key), aiNotes])).rows[0].id;
  const call = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } });
    return { status: r.status, body: await r.json() };
  };
  const c = await call('/api/connect', { method: 'POST', body: JSON.stringify({ eventsUrl: sim.eventsUrl }) });
  if (c.status !== 200) throw new Error('connect failed ' + JSON.stringify(c.body));
  let pushed = 0;
  const push = evs => { pushed += evs.length; sim.push(evs); };
  // Wait until the worker has stored every event pushed so far (or give up).
  const drain = async (timeoutMs = 20000, expect = null) => {
    const t0 = Date.now();
    for (;;) {
      const n = (await q(`select count(*)::int n from events where performer_id=$1`, [pid])).rows[0].n;
      if (n >= (expect ?? pushed)) return { ok: true, ms: Date.now() - t0, stored: n };
      if (Date.now() - t0 > timeoutMs) return { ok: false, ms: Date.now() - t0, stored: n };
      await wait(25);
    }
  };
  const feedKinds = async () => (await call('/api/feed?limit=200')).body.items.map(i => `${i.kind}${i.username ? ':' + i.username : ''}`).reverse();
  return { username, sim, key, pid, call, push, drain, feedKinds, ev: sim.ev, user: sim.user };
}

const results = [];
async function scenario(id, group, title, expected, fn) {
  if (only && !only.includes(id)) return;
  const t0 = Date.now();
  let r;
  try { r = await fn(); } catch (e) { r = { pass: false, observed: 'harness error: ' + e.message }; }
  results.push({ id, group, title, expected, ...r, ms: Date.now() - t0 });
  console.log(`${r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'MEAS'}  ${id}  ${title}\n      ${r.observed}`);
}

// ---------- normal ----------
await scenario('N1', 'normal', 'A plain stream: three viewers, chat, one tip, then she stops',
  'Recap shows 3 visitors, 1 tipper, 25 tokens. Callouts match each viewer.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStart', {}),
      ev('userEnter', { user: user('gray_one') }),
      ev('userEnter', { user: user('blue_one', { hasTokens: true, colorGroup: 'lightblue' }) }),
      ev('userEnter', { user: user('blue_two', { hasTokens: true, colorGroup: 'lightblue' }) }),
      ev('chatMessage', { user: user('blue_one', { hasTokens: true }), message: { message: 'hello there' } }),
      ev('tip', { user: user('blue_one', { hasTokens: true }), tip: { tokens: 25, message: '', isAnon: false } }),
      ev('broadcastStop', {})]);
    await R.drain();
    const rec = (await R.call('/api/recap')).body.recap;
    const kinds = await R.feedKinds();
    const pass = rec.uniqueVisitors === 3 && rec.tippers === 1 && rec.tokens === 25 && rec.lightBluesConverted === 1
      && kinds.join() === 'live,new_viewer:gray_one,new_with_tokens:blue_one,new_with_tokens:blue_two,first_tip:blue_one,recap';
    return { pass, observed: `visitors ${rec.uniqueVisitors}, tippers ${rec.tippers}, tokens ${rec.tokens}, converted ${rec.lightBluesConverted}; feed: ${kinds.join(', ')}` };
  });

await scenario('N2', 'normal', 'The same event delivered twice',
  'Counted once.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    const tip = ev('tip', { user: user('dup_fan', { hasTokens: true }), tip: { tokens: 50, message: '', isAnon: false } });
    R.sim.push([ev('broadcastStart', {}), tip, tip, { ...tip }]);
    await R.drain(8000, 2); await wait(1500);
    const f = (await q(`select total_tips, tip_count from fans where performer_id=$1 and username='dup_fan'`, [R.pid])).rows[0];
    return { pass: f.total_tips === 50 && f.tip_count === 1, observed: `total ${f.total_tips} tokens from ${f.tip_count} tip` };
  });

// ---------- cold start / missing history ----------
await scenario('C1', 'missing information', 'StreamWing connects mid-stream. A viewer Chaturbate reports as a heavy recent tipper walks in and tips 33',
  'Not stated as fact that the viewer is new or that this is their first tip ever. StreamWing has no history for the room yet.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    const whale = user('old_whale', { hasTokens: true, colorGroup: 'purple', recentTips: 'tons' });
    R.push([ev('userEnter', { user: whale }), ev('tip', { user: whale, tip: { tokens: 33, message: '', isAnon: false } })]);
    await R.drain();
    const items = (await R.call('/api/feed?limit=20')).body.items.reverse();
    const enter = items.find(i => i.username === 'old_whale' && i.kind !== 'tip' && i.kind !== 'first_tip');
    const tip = items.find(i => i.kind === 'tip' || i.kind === 'first_tip');
    const hedged = !!(enter?.data?.unsure && tip?.data?.unsure);
    return { pass: hedged, observed: `arrival labelled "${enter?.kind}"${enter?.data?.unsure ? ' (marked unsure)' : ''}, tip labelled "${tip?.kind}"${tip?.data?.unsure ? ' (marked unsure)' : ''}, counted as a light-blue conversion: ${!!tip?.data?.converted}` };
  });

// ---------- unusual ----------
await scenario('U1', 'unusual', 'After the stream ends, a viewer follows, tips and chats while she is offline',
  'She is shown as offline. No new stream is opened.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    const a = user('late_fan', { hasTokens: true });
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: a }), ev('broadcastStop', {})]);
    await R.drain();
    R.push([ev('follow', { user: a }), ev('tip', { user: a, tip: { tokens: 10, message: '', isAnon: false } }), ev('chatMessage', { user: a, message: { message: 'miss you' } })]);
    await R.drain();
    const me = (await R.call('/api/me')).body;
    const n = (await q(`select count(*)::int n from sessions where performer_id=$1`, [R.pid])).rows[0].n;
    return { pass: me.live === false && n === 1, observed: `panel says live: ${me.live}; streams on record: ${n}` };
  });

await scenario('U2', 'unusual', 'The stop event for a stream never arrives. 26 hours later she goes live again',
  'The old stream is closed at a believable length and gets a recap.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: user('u2_fan') })]);
    await R.drain();
    await q(`update sessions set started_at = now() - interval '26 hours' where performer_id=$1`, [R.pid]); // simulate the passage of time
    R.push([ev('broadcastStart', {})]);
    await R.drain();
    const s = (await q(`select round(extract(epoch from (ended_at - started_at))/60)::int mins from sessions where performer_id=$1 order by started_at limit 1`, [R.pid])).rows[0];
    const recaps = (await R.feedKinds()).filter(k => k === 'recap').length;
    return { pass: s.mins < 600 && recaps === 1, observed: `old stream recorded as ${s.mins} minutes long; recaps written for it: ${recaps}` };
  });

await scenario('U3', 'unusual', 'A stream was left open (no stop event). The next day a viewer walks in and no start event arrives',
  'A new stream is opened for the new day.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: user('day1_fan') })]);
    await R.drain();
    await q(`update sessions set started_at = now() - interval '26 hours' where performer_id=$1`, [R.pid]);
    await q(`update fans set last_seen = now() - interval '26 hours' where performer_id=$1`, [R.pid]);
    R.push([ev('userEnter', { user: user('day2_fan') })]);
    await R.drain();
    const n = (await q(`select count(*)::int n, max(unique_visitors) v from sessions where performer_id=$1`, [R.pid])).rows[0];
    return { pass: n.n === 2, observed: `streams on record: ${n.n}; the one stream now holds ${n.v} visitors from both days` };
  });

await scenario('U4', 'unusual', 'One stream that crosses midnight UTC. A viewer steps out and comes back 40 minutes later',
  'Still one day in her room.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: user('tz_fan') })]);
    await R.drain();
    // Simulate: the first entry happened before midnight UTC, 40 minutes ago.
    await q(`update fans set last_visit_day = current_date - 1, last_seen = now() - interval '40 minutes' where performer_id=$1`, [R.pid]);
    R.push([ev('userEnter', { user: user('tz_fan') })]);
    await R.drain();
    const f = (await q(`select visit_days from fans where performer_id=$1 and username='tz_fan'`, [R.pid])).rows[0];
    return { pass: f.visit_days === 1, observed: `days in her room after one stream: ${f.visit_days}` };
  });

// ---------- contradictory ----------
await scenario('X1', 'contradictory information', 'Chaturbate sends "broadcast started" four times in a row (encoder reconnects)',
  'Still one stream. A tipper from the last stream is not reported as slipping away.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    const t = user('loyal_tipper', { hasTokens: true });
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: t }), ev('tip', { user: t, tip: { tokens: 200, message: '', isAnon: false } }), ev('broadcastStop', {})]);
    await R.drain();
    R.push([ev('broadcastStart', {}), ev('broadcastStart', {}), ev('broadcastStart', {}), ev('broadcastStart', {})]);
    await R.drain();
    const slip = (await R.call('/api/slipping')).body.fans.map(f => `${f.username} (missed ${f.missed_streams})`);
    const g = (await R.call('/api/growth')).body.streams;
    const zero = g.filter(s => s.minutes === 0 && s.visitors === 0).length;
    return { pass: slip.length === 0 && zero === 0, observed: `slipping away list: ${slip.join(', ') || 'empty'}; empty zero-minute streams in her growth chart: ${zero}` };
  });

await scenario('X2', 'contradictory information', 'A viewer shown with tokens later shows without, then tips; a stop arrives with no start',
  'No crash. The tip is recorded once and the feed keeps moving.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStop', {}), ev('userEnter', { user: user('flip', { hasTokens: true }) }), ev('chatMessage', { user: user('flip', { hasTokens: false }), message: { message: 'hi' } }),
      ev('tip', { user: user('flip', { hasTokens: false }), tip: { tokens: 5, message: '', isAnon: false } }), ev('userEnter', { user: user('after_flip') })]);
    const d = await R.drain();
    const f = (await q(`select total_tips from fans where performer_id=$1 and username='flip'`, [R.pid])).rows[0];
    const seen = (await R.feedKinds()).some(k => k.endsWith(':after_flip'));
    return { pass: d.ok && f.total_tips === 5 && seen, observed: `all events stored: ${d.ok}; tip total ${f.total_tips}; later viewer shown: ${seen}` };
  });

// ---------- failures ----------
await scenario('F1', 'failures', 'Malformed and unknown events: no user, no method, an event type that does not exist yet, a chat with no text',
  'Skipped without stopping the feed. The next real viewer still shows.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.sim.push([ev('broadcastStart', {}), ev('tip', {}), { id: 'no-method-1', object: {} }, ev('somethingNew2027', { user: user('x') }),
      ev('chatMessage', { user: user('quiet'), message: null }), ev('userEnter', { user: user('after_junk') })]);
    await wait(4000);
    const seen = (await R.feedKinds()).some(k => k.endsWith(':after_junk'));
    const err = (await q(`select last_error from performers where id=$1`, [R.pid])).rows[0].last_error;
    return { pass: seen && !err, observed: `later viewer shown: ${seen}; error on the room: ${err || 'none'}` };
  });

await scenario('F2', 'failures', 'One event the database cannot store (a tip message containing a null character)',
  'That one event is set aside. Everything after it still shows.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.sim.push([ev('broadcastStart', {}), ev('userEnter', { user: user('before_bad') }),
      ev('tip', { user: user('before_bad'), tip: { tokens: 5, message: 'bad \u0000 byte', isAnon: false } }),
      ev('userEnter', { user: user('after_bad') })]);
    await wait(9000);
    const seen = (await R.feedKinds()).some(k => k.endsWith(':after_bad'));
    const p = (await q(`select last_error from performers where id=$1`, [R.pid])).rows[0];
    return { pass: seen, observed: `viewer after the bad event shown after 9 seconds: ${seen}; error on the room: ${p.last_error || 'none'}` };
  });

await scenario('F3', 'failures', 'A tip larger than the tokens column can hold (3,000,000,000)',
  'That one event is set aside. Everything after it still shows.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.sim.push([ev('broadcastStart', {}), ev('tip', { user: user('huge'), tip: { tokens: 3000000000, message: '', isAnon: false } }), ev('userEnter', { user: user('after_huge') })]);
    await wait(9000);
    const seen = (await R.feedKinds()).some(k => k.endsWith(':after_huge'));
    const p = (await q(`select last_error from performers where id=$1`, [R.pid])).rows[0];
    return { pass: seen, observed: `viewer after the bad event shown after 9 seconds: ${seen}; error on the room: ${p.last_error || 'none'}` };
  });

await scenario('F4', 'failures', 'The AI service refuses every request (429) while fan notes are being written',
  'Notes are tried again later.', async () => {
    const R = await newRoom({ aiNotes: true }); const { ev, user } = R;
    ai.mode = '429'; ai.calls.length = 0;
    const a = user('note_fan', { hasTokens: true });
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: a }), ev('chatMessage', { user: a, message: { message: 'I went hiking today' } }),
      ev('tip', { user: a, tip: { tokens: 20, message: '', isAnon: false } }), ev('broadcastStop', {})]);
    await R.drain(); await wait(6000);
    const f = (await q(`select note from fans where performer_id=$1 and username='note_fan'`, [R.pid])).rows[0];
    const calls = ai.calls.length; ai.mode = 'ok';
    return { pass: !!f.note || calls > 1, observed: `attempts made: ${calls}; note stored: ${f.note ? 'yes' : 'no'}; nothing queued for a retry` };
  });

await scenario('F5', 'failures', 'The AI returns 60 words when asked for 18 at most',
  'The note is cut to 18 words or rejected.', async () => {
    const R = await newRoom({ aiNotes: true }); const { ev, user } = R;
    ai.mode = 'long';
    const a = user('long_fan', { hasTokens: true });
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: a }), ev('chatMessage', { user: a, message: { message: 'hello' } }), ev('broadcastStop', {})]);
    await R.drain(); await wait(2500); ai.mode = 'ok';
    const f = (await q(`select note from fans where performer_id=$1 and username='long_fan'`, [R.pid])).rows[0];
    const words = (f.note || '').split(/\s+/).filter(Boolean).length;
    return { pass: words > 0 && words <= 18, observed: `stored note is ${words} words, ${(f.note || '').length} characters` };
  });

// ---------- privacy ----------
await scenario('P1', 'privacy', 'A private message, a public chat line and a tip message, each with a unique marker, then a later arrival',
  'Private text is nowhere in the database. Public chat text is only on the fan record (last five).', async () => {
    const R = await newRoom(); const { ev, user } = R;
    const a = user('marker_fan', { hasTokens: true });
    R.push([ev('broadcastStart', {}), ev('userEnter', { user: a }),
      ev('privateMessage', { user: a, message: { message: 'PM_MARK_771', fromUser: 'marker_fan', toUser: R.username } }),
      ev('chatMessage', { user: a, message: { message: 'CHAT_MARK_772' } }),
      ev('tip', { user: a, tip: { tokens: 5, message: 'TIP_MARK_773', isAnon: false } }),
      ev('follow', { user: a }), ev('broadcastStop', {})]);
    await R.drain();
    const where = async mark => {
      const out = [];
      for (const [t, col] of [['events', 'payload::text'], ['feed', 'data::text'], ['fans', 'fans::text'], ['sessions', 'sessions::text']]) {
        const n = (await q(`select count(*)::int n from ${t} where performer_id=$1 and ${col} like $2`, [R.pid, `%${mark}%`])).rows[0].n;
        if (n) out.push(`${t} x${n}`);
      }
      return out.join(', ') || 'nowhere';
    };
    const pm = await where('PM_MARK_771'), chat = await where('CHAT_MARK_772'), tip = await where('TIP_MARK_773');
    const g = (await q(`select gender from fans where performer_id=$1 and username='marker_fan'`, [R.pid])).rows[0].gender;
    return { pass: pm === 'nowhere' && chat === 'fans x1', observed: `private text: ${pm}; public chat text: ${chat}; tip message: ${tip}; viewer gender stored: ${g ? 'yes' : 'no'}` };
  });

// ---------- extended session / load ----------
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function bigStream(R, viewers, seed) {
  const { ev, user } = R; const r = rng(seed);
  const evs = []; const truth = { visitors: viewers, tokens: 0, tippers: 0, messages: 0 };
  const per = [];
  for (let i = 0; i < viewers; i++) {
    const u = user(`v${seed}_${i}`, { hasTokens: r() < 0.3 });
    const mine = [ev('userEnter', { user: u })];
    const chats = r() < 0.4 ? 1 + Math.floor(r() * 4) : 0;
    for (let c = 0; c < chats; c++) { mine.push(ev('chatMessage', { user: u, message: { message: `message ${c} from viewer ${i}` } })); truth.messages++; }
    if (r() < 0.08) { const n = 1 + Math.floor(r() * 3); truth.tippers++; for (let t = 0; t < n; t++) { const tk = 1 + Math.floor(r() * 200); truth.tokens += tk; mine.push(ev('tip', { user: u, tip: { tokens: tk, message: '', isAnon: false } })); } }
    if (r() < 0.7) mine.push(ev('userLeave', { user: u }));
    per.push(mine);
  }
  // Interleave viewers while keeping each viewer's own order.
  const live = per.map(m => ({ m, i: 0 }));
  while (live.length) { const k = Math.floor(r() * live.length); const x = live[k]; evs.push(x.m[x.i++]); if (x.i >= x.m.length) live.splice(k, 1); }
  return { evs: [ev('broadcastStart', {}), ...evs, ev('broadcastStop', {})], truth };
}

await scenario('L1', 'extended session', 'One busy room: 4,000 viewers in one stream, with chat, tips and leaves, delivered as fast as the worker can take them',
  'Recap totals equal the generated ground truth exactly.', async () => {
    const R = await newRoom();
    const { evs, truth } = bigStream(R, 4000, 7);
    const t0 = Date.now(); R.push(evs);
    const d = await R.drain(170000);
    const secs = (Date.now() - t0) / 1000;
    const s = (await q(`select unique_visitors v, tokens, tippers, messages from sessions where performer_id=$1`, [R.pid])).rows[0];
    const t1 = Date.now(); await R.call('/api/fans'); const fansMs = Date.now() - t1;
    const t2 = Date.now(); await R.call('/api/room'); const roomMs = Date.now() - t2;
    const pass = d.ok && s.v === truth.visitors && s.tokens === truth.tokens && s.tippers === truth.tippers && s.messages === truth.messages;
    return { pass, measure: { events: evs.length, seconds: +secs.toFixed(1), eventsPerSecond: Math.round(d.stored / secs), fansMs, roomMs },
      observed: `${d.stored} of ${evs.length} events in ${secs.toFixed(1)}s (${Math.round(d.stored / secs)} a second); recap visitors ${s.v}/${truth.visitors}, tokens ${s.tokens}/${truth.tokens}, tippers ${s.tippers}/${truth.tippers}, messages ${s.messages}/${truth.messages}; fan list answered in ${fansMs} ms, room list in ${roomMs} ms` };
  });

await scenario('L2', 'extended session', '25 rooms live at once, 300 viewers each',
  'Every room\'s recap equals its own ground truth. No room sees another\'s numbers.', async () => {
    const rooms = []; for (let i = 0; i < 25; i++) rooms.push(await newRoom());
    const gen = rooms.map((R, i) => bigStream(R, 300, 100 + i));
    const t0 = Date.now(); rooms.forEach((R, i) => R.push(gen[i].evs));
    const ds = await Promise.all(rooms.map(R => R.drain(170000)));
    const secs = (Date.now() - t0) / 1000;
    let good = 0;
    for (let i = 0; i < rooms.length; i++) {
      const s = (await q(`select unique_visitors v, tokens, tippers, messages from sessions where performer_id=$1`, [rooms[i].pid])).rows[0];
      const t = gen[i].truth; if (s && s.v === t.visitors && s.tokens === t.tokens && s.tippers === t.tippers && s.messages === t.messages) good++;
    }
    const total = ds.reduce((a, d) => a + d.stored, 0);
    return { pass: good === 25 && ds.every(d => d.ok), measure: { events: total, seconds: +secs.toFixed(1), eventsPerSecond: Math.round(total / secs) },
      observed: `${good} of 25 recaps exact; ${total} events across all rooms in ${secs.toFixed(1)}s (${Math.round(total / secs)} a second in total)` };
  });

await scenario('L3', 'latency', 'Delay from Chaturbate handing over an event to it appearing on an open panel (quiet room, 40 samples)',
  'Measured, not judged. Chaturbate\'s own delivery delay is not included.', async () => {
    const R = await newRoom(); const { ev, user } = R;
    R.push([ev('broadcastStart', {})]); await R.drain();
    const got = new Map();
    const ctrl = new AbortController();
    const res = await fetch(`${API}/api/stream?k=${R.key}`, { signal: ctrl.signal });
    (async () => { const dec = new TextDecoder(); let buf = '';
      try { for await (const chunk of res.body) { buf += dec.decode(chunk, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (line.startsWith('data: ')) { try { const it = JSON.parse(line.slice(6)); if (it.username) got.set(it.username, Date.now()); } catch {} } } } } catch {} })();
    await wait(300);
    const lat = [];
    for (let i = 0; i < 40; i++) {
      const name = `lat_${i}`; const t0 = Date.now(); R.push([ev('userEnter', { user: user(name) })]);
      const dl = Date.now() + 5000; while (!got.has(name) && Date.now() < dl) await wait(2);
      if (got.has(name)) lat.push(got.get(name) - t0);
      await wait(150 + (i % 5) * 170);
    }
    ctrl.abort();
    lat.sort((a, b) => a - b);
    const pc = p => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
    return { pass: null, measure: { samples: lat.length, p50: pc(0.5), p95: pc(0.95), max: lat[lat.length - 1] },
      observed: `${lat.length} of 40 arrived; median ${pc(0.5)} ms, 95th percentile ${pc(0.95)} ms, slowest ${lat[lat.length - 1]} ms` };
  });

// ---------- access ----------
await scenario('A1', 'security', 'Eleven connection attempts from one network address inside 15 minutes; the eleventh is a real streamer with a valid link',
  'The real streamer gets in. Only repeated failures from one person are slowed down.', async () => {
    const sim = await createSim({ username: 'room_ratelimit', token: 'tokratelimit1' });
    const post = url => fetch(API + '/api/open-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventsUrl: url }) }).then(async r => ({ status: r.status, body: await r.json() }));
    const codes = []; for (let i = 0; i < 10; i++) codes.push((await post('https://not-a-link.example/x')).status);
    const real = await post(sim.eventsUrl);
    return { pass: real.status === 200, observed: `first ten answered ${[...new Set(codes)].join('/')}; the real streamer's valid link answered ${real.status}${real.body.error ? ' "' + real.body.error + '"' : ''}` };
  });

fs.writeFileSync(outFile, JSON.stringify({ workerDir, ranAt: new Date().toISOString(), node: process.version, results }, null, 2));
const pass = results.filter(r => r.pass === true).length, fail = results.filter(r => r.pass === false).length;
console.log(`\n${pass} pass, ${fail} fail, ${results.length - pass - fail} measured only. Written to ${outFile}`);
aiServer.close(); clearInterval(timer); server.close();
setTimeout(() => process.exit(0), 300);
