// The panel's API. Every request is authenticated with the performer's access key
// (the secret part of her /start link). The database is never exposed directly.
import http from 'node:http';
import { config } from './config.js';
import { q, tx } from './db.js';
import { encrypt, hashKey } from './crypto.js';
import { parseEventsUrl, poll, CbError } from './cb.js';
import { subscribe } from './bus.js';
import { startLoop, stopLoop, isPolling } from './poller.js';
import { buildRecap } from './brain.js';

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (config.allowedOrigins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10000) throw Object.assign(new Error('too large'), { status: 413 });
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

async function auth(req, url) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('k');
  if (!key || key.length < 20) return null;
  const r = await q(`select * from performers where access_key_hash=$1 and approved`, [hashKey(key)]);
  return r.rows[0] || null;
}

const FAN_FIELDS = `username, first_seen, last_seen, visits, visit_days, total_tips, tip_count, biggest_tip,
  first_tip_at, last_tip_at, color_group, recent_tips, has_tokens, is_follower, in_fanclub, is_mod,
  language, last_message, last_message_at, messages_count, note, note_at, recent_messages, owner_note, owner_note_at`;

async function status(p) {
  const s = await q(`select * from sessions where performer_id=$1 order by started_at desc limit 1`, [p.id]);
  const session = s.rows[0] || null;
  const counts = await q(
    `select count(*)::int as fans, count(*) filter (where total_tips > 0)::int as tippers,
            count(*) filter (where has_tokens and total_tips = 0)::int as light_blues
     from fans where performer_id=$1`, [p.id]);
  return {
    username: p.cb_username,
    displayName: p.display_name || p.cb_username,
    connected: !!p.cb_token_enc,
    polling: isPolling(p.id),
    lastEventAt: p.last_event_at, lastPollAt: p.last_poll_at, lastError: p.last_error,
    live: !!(session && !session.ended_at),
    session,
    totals: counts.rows[0],
  };
}

export function startHttp() {
  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    try {
      if (path === '/health') return send(res, 200, { ok: true, ai: !!config.aiKey, keySource: config.keySource, monitor: !!config.healthcheckUrl });

      const p = await auth(req, url);
      if (!p) return send(res, 401, { error: 'This link is not valid. Ask StreamWing for a new one.' });

      if (req.method === 'GET' && path === '/api/me') return send(res, 200, await status(p));

      if (req.method === 'POST' && path === '/api/connect') {
        const { eventsUrl } = await readJson(req);
        let base;
        try { base = parseEventsUrl(eventsUrl, p.cb_username); } catch (e) { return send(res, 400, { error: e.message }); }
        // Prove the link works before saving it. timeout=0 returns straight away.
        try { await poll(base, 0); } catch (e) {
          if (e instanceof CbError && e.auth) return send(res, 400, { error: "Chaturbate didn't accept that. Make a new token and tick Events API (public) only, not the crossed-out Events API, then copy the new link." });
          return send(res, 502, { error: "Couldn't reach Chaturbate just now. Try again in a minute." });
        }
        await q(`update performers set cb_token_enc=$2, next_url_enc=null, connected_at=now(), last_error=null where id=$1`,
          [p.id, encrypt(base, config.tokenKey)]);
        startLoop(p.id);
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && path === '/api/disconnect') {
        const { deleteData } = await readJson(req);
        stopLoop(p.id);
        if (deleteData) {
          await tx(async c => {
            for (const t of ['feed', 'events', 'fans']) await c.query(`delete from ${t} where performer_id=$1`, [p.id]);
            await c.query(`delete from sessions where performer_id=$1`, [p.id]);
          });
        }
        await q(`update performers set cb_token_enc=null, next_url_enc=null, connected_at=null where id=$1`, [p.id]);
        return send(res, 200, { ok: true, deleted: !!deleteData });
      }

      if (req.method === 'GET' && path === '/api/feed') {
        const limit = Math.min(Number(url.searchParams.get('limit') || 60), 200);
        const r = await q(`select id, session_id, kind, username, data, created_at from feed where performer_id=$1 order by id desc limit $2`, [p.id, limit]);
        return send(res, 200, { items: r.rows });
      }

      if (req.method === 'GET' && path === '/api/room') {
        // Who's in the room right now, best-first.
        const s = await q(`select id from sessions where performer_id=$1 and ended_at is null order by started_at desc limit 1`, [p.id]);
        if (!s.rows[0]) return send(res, 200, { fans: [] });
        const r = await q(
          `select ${FAN_FIELDS.split(',').map(f => 'f.' + f.trim()).join(', ')}, sf.tipped as tipped_today
           from session_fans sf join fans f on f.performer_id=$2 and f.username=sf.username
           where sf.session_id=$1 and sf.in_room
           order by f.total_tips desc, f.visit_days desc, f.has_tokens desc nulls last limit 100`, [s.rows[0].id, p.id]);
        return send(res, 200, { fans: r.rows });
      }

      // Everyone she's met, best first, with an optional name search.
      if (req.method === 'GET' && path === '/api/fans') {
        const term = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
        const r = await q(
          `select ${FAN_FIELDS} from fans where performer_id=$1 and ($2 = '' or lower(username) like $2 || '%')
           order by total_tips desc, visit_days desc, last_seen desc limit 100`, [p.id, term]);
        return send(res, 200, { fans: r.rows });
      }

      // Regulars and tippers who've missed her last 3 or more streams.
      if (req.method === 'GET' && path === '/api/slipping') {
        const r = await q(
          `select * from (
             select ${FAN_FIELDS.split(',').map(f => 'f.' + f.trim()).join(', ')},
               (select count(*)::int from sessions s where s.performer_id = f.performer_id and s.started_at > f.last_seen) as missed_streams
             from fans f where f.performer_id=$1 and (f.total_tips > 0 or f.visit_days >= $2)) x
           where missed_streams >= 3
           order by total_tips desc, visit_days desc limit 30`, [p.id, config.regularDays]);
        return send(res, 200, { fans: r.rows });
      }

      // Every stream, newest first, so the panel can compare each with the one before.
      if (req.method === 'GET' && path === '/api/sessions') {
        const r = await q(`select * from sessions where performer_id=$1 order by started_at desc limit 30`, [p.id]);
        return send(res, 200, { sessions: r.rows });
      }

      const noteMatch = path.match(/^\/api\/fans\/([^/]+)\/note$/);
      if (req.method === 'POST' && noteMatch) {
        const { note } = await readJson(req);
        const text = String(note ?? '').trim().slice(0, 500);
        const r = await q(
          `update fans set owner_note = nullif($3, ''), owner_note_at = now() where performer_id=$1 and username=$2 returning owner_note, owner_note_at`,
          [p.id, decodeURIComponent(noteMatch[1]), text]);
        return r.rows[0] ? send(res, 200, r.rows[0]) : send(res, 404, { error: 'not found' });
      }

      const fanMatch = path.match(/^\/api\/fans\/([^/]+)$/);
      if (req.method === 'GET' && fanMatch) {
        const uname = decodeURIComponent(fanMatch[1]);
        const r = await q(`select ${FAN_FIELDS} from fans where performer_id=$1 and username=$2`, [p.id, uname]);
        if (!r.rows[0]) return send(res, 404, { error: 'not found' });
        const tips = await q(
          `select received_at as at, (payload->'object'->'tip'->>'tokens')::int as tokens, payload->'object'->'tip'->>'message' as message
           from events where performer_id=$1 and username=$2 and method='tip' order by received_at desc limit 10`, [p.id, uname]);
        const streams = await q(
          `select s.id, s.started_at, s.ended_at, sf.tipped from session_fans sf join sessions s on s.id = sf.session_id
           where s.performer_id=$1 and sf.username=$2 order by s.started_at desc limit 10`, [p.id, uname]);
        const count = await q(
          `select count(*)::int n from session_fans sf join sessions s on s.id = sf.session_id where s.performer_id=$1 and sf.username=$2`, [p.id, uname]);
        return send(res, 200, { ...r.rows[0], tips: tips.rows, streams: streams.rows, streams_attended: count.rows[0].n });
      }

      if (req.method === 'GET' && path === '/api/recap') {
        const r = await q(`select * from sessions where performer_id=$1 order by started_at desc limit 1`, [p.id]);
        if (!r.rows[0]) return send(res, 200, { recap: null });
        const c = { query: (t, v) => q(t, v) };
        return send(res, 200, { recap: await buildRecap(c, r.rows[0]), session: r.rows[0] });
      }

      if (req.method === 'GET' && path === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-accel-buffering': 'no',
        });
        res.write(`retry: 3000\n\n`);
        const unsub = subscribe(p.id, item => res.write(`data: ${JSON.stringify(item)}\n\n`));
        const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
        req.on('close', () => { unsub(); clearInterval(ping); });
        return;
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[http]', path, e);
      return send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on our side.' });
    }
  });
  server.listen(config.port, () => console.log(`[http] listening on ${config.port}`));
  return server;
}
