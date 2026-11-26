// Tells an uptime monitor whether StreamWing is healthy, so we hear about a problem before a performer does.
// Every minute the worker pings HEALTHCHECK_URL. If anything is wrong it pings HEALTHCHECK_URL/fail with a short
// reason. If the worker dies, the pings stop and the monitor alerts us on its own.
// What leaves the server: performer usernames and error text. No fan names, chat or tips.
import { q } from './db.js';
import { config } from './config.js';

const STALE_MIN = 3;

export async function problems() {
  const out = [];
  const r = await q(
    `select cb_username, last_error, last_poll_at, connected_at from performers
      where cb_token_enc is not null and approved`);
  for (const p of r.rows) {
    if (p.last_error) { out.push(`${p.cb_username}: ${p.last_error}`); continue; }
    const last = p.last_poll_at || p.connected_at;
    if (last && Date.now() - new Date(last).getTime() > STALE_MIN * 60000) out.push(`${p.cb_username}: no contact with Chaturbate for ${STALE_MIN}+ minutes`);
  }
  return out;
}

export async function runCheck(url = config.healthcheckUrl) {
  if (!url) return { skipped: true };
  let bad;
  try { bad = await problems(); } catch (e) { bad = [`database check failed: ${String(e.message).slice(0, 120)}`]; }
  const target = bad.length ? url.replace(/\/+$/, '') + '/fail' : url;
  try {
    await fetch(target, { method: 'POST', body: bad.join('\n') || 'ok', signal: AbortSignal.timeout(10000) });
  } catch (e) { console.error('[monitor] ping failed:', e.message); }
  return { problems: bad, target };
}

export function startMonitor() {
  if (!config.healthcheckUrl) { console.log('[monitor] off (no HEALTHCHECK_URL)'); return null; }
  console.log('[monitor] on');
  runCheck();
  return setInterval(runCheck, 60000);
}
