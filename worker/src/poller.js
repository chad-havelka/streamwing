// Keeps one long-poll loop running per connected performer, for as long as the worker is up.
import { config } from './config.js';
import { q, tx } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { poll, normalizeEvent, restartFor, sameHost } from './cb.js';
import { processEvent } from './brain.js';
import { publish } from './bus.js';
import { writeNotesForSession } from './ai.js';

const loops = new Map(); // performerId -> { stop }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runLoop(performerId, state) {
  let backoff = 1000;
  let restarts = 0;
  while (!state.stopped) {
    const pr = await q(`select * from performers where id=$1`, [performerId]);
    const performer = pr.rows[0];
    if (!performer || !performer.cb_token_enc || !performer.approved) break;

    let url;
    try {
      url = decrypt(performer.next_url_enc || performer.cb_token_enc, config.tokenKey);
    } catch {
      await q(`update performers set last_error=$2 where id=$1`, [performerId, 'Saved link could not be read. Reconnect Chaturbate.']);
      break;
    }

    try {
      const { events, nextUrl } = await poll(url, config.pollTimeoutSec);
      for (const raw of events) {
        const ev = normalizeEvent(raw);
        if (!ev.id || !ev.method) continue;
        const out = await tx(c => processEvent(c, performer, ev));
        if (!out.duplicate) for (const item of out.items) {
          publish(performerId, item);
          // When a stream ends, write the AI notes in the background. It never holds up the feed.
          if (item.kind === 'recap' && item.session_id) writeNotesForSession(performerId, item.session_id);
        }
      }
      await q(
        `update performers set next_url_enc = coalesce($2, next_url_enc), last_poll_at=now(), last_error=null,
           last_event_at = case when $3 then now() else last_event_at end where id=$1`,
        [performerId, nextUrl && sameHost(nextUrl, url) ? encrypt(nextUrl, config.tokenKey) : null, events.length > 0]);
      publish(performerId, { kind: 'heartbeat', transient: true, data: { at: new Date().toISOString() } });
      backoff = 1000;
      restarts = 0;
    } catch (err) {
      if (err.auth) {
        // Token deleted or wrong. Stop until she reconnects; don't hammer Chaturbate.
        await q(`update performers set last_error=$2, next_url_enc=null, feed_started_at=now() where id=$1`,
          [performerId, 'Chaturbate rejected the saved link. It may have been deleted. Reconnect Chaturbate.']);
        publish(performerId, { kind: 'status', transient: true, data: { error: 'token_rejected' } });
        break;
      }
      // Our place in the feed got too old (worker was down a while). Chaturbate sends a fresh link: use it.
      const fresh = err.restartUrl && restartFor(err.restartUrl, url);
      if (fresh) {
        await q(`update performers set next_url_enc=$2, feed_started_at=now(), last_error=null where id=$1`, [performerId, encrypt(fresh, config.tokenKey)]);
        console.log(`[poll ${performer.cb_username}] saved place was too old; restarted from Chaturbate's fresh link`);
        if (++restarts > 3) await sleep(backoff); // never spin if it keeps happening
        continue;
      }
      // A stale cursor can 404; fall back to the base URL once.
      if (err.status === 404 && performer.next_url_enc) {
        await q(`update performers set next_url_enc=null, feed_started_at=now() where id=$1`, [performerId]);
        continue;
      }
      console.error(`[poll ${performer.cb_username}]`, err.message);
      await q(`update performers set last_error=$2 where id=$1`, [performerId, String(err.message).slice(0, 200)]);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
  loops.delete(performerId);
}

export function startLoop(performerId) {
  if (loops.has(performerId)) return;
  const state = { stopped: false };
  loops.set(performerId, state);
  runLoop(performerId, state).catch(err => {
    console.error('[poller] loop crashed', performerId, err);
    loops.delete(performerId);
  });
}

export function stopLoop(performerId) {
  const s = loops.get(performerId);
  if (s) s.stopped = true;
}

export const isPolling = performerId => loops.has(performerId);

// Every 15 seconds, make sure every connected performer has a running loop.
export function startSupervisor() {
  const tick = async () => {
    try {
      const r = await q(`select id from performers where cb_token_enc is not null and approved`);
      for (const { id } of r.rows) startLoop(id);
    } catch (e) {
      console.error('[supervisor]', e.message);
    }
  };
  tick();
  return setInterval(tick, 15000);
}
