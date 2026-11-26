// Deletes old raw events so we hold strangers' data for a limited time.
// Tips are kept: they are the source of each fan's tip log. Everything else in the raw log expires.
import { q } from './db.js';
import { config } from './config.js';

export async function purgeOldEvents(days = config.eventRetentionDays) {
  if (!(days > 0)) return 0; // 0 or blank means keep everything
  const r = await q(`delete from events where received_at < now() - ($1 || ' days')::interval and method <> 'tip'`, [String(days)]);
  return r.rowCount;
}

export function startPurge() {
  const run = async () => {
    try { const n = await purgeOldEvents(); if (n) console.log(`[purge] removed ${n} old events`); }
    catch (e) { console.error('[purge]', e.message); }
  };
  run();
  return setInterval(run, 6 * 3600 * 1000);
}
