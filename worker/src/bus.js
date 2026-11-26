// In-process fan-out from the poller to any open panels (Server-Sent Events).
const subs = new Map(); // performerId -> Set<fn>

export function subscribe(performerId, fn) {
  if (!subs.has(performerId)) subs.set(performerId, new Set());
  subs.get(performerId).add(fn);
  return () => subs.get(performerId)?.delete(fn);
}

export function publish(performerId, item) {
  const set = subs.get(performerId);
  if (!set) return;
  for (const fn of set) {
    try { fn(item); } catch { /* a closed panel shouldn't break the others */ }
  }
}
