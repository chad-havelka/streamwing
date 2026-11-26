// A stand-in for Chaturbate's Events API, for testing and demos.
// Serves GET /events/<username>/<token>/?timeout=N in the same long-poll shape:
//   { "events": [ { "method": "...", "id": "...", "object": {...} } ], "nextUrl": "..." }
// Control endpoints (test only): POST /sim/push  body: [events]   POST /sim/script/<name>
import http from 'node:http';

export function createSim({ username = 'sim_room', token = 'simtoken123', port = 0 } = {}) {
  const log = [];          // every event ever pushed
  const waiters = new Set();
  let seq = 0;
  let base = '';

  const user = (name, o = {}) => ({
    username: name, colorGroup: o.colorGroup ?? 'grey', hasTokens: o.hasTokens ?? false,
    recentTips: o.recentTips ?? 'none', isFollower: !!o.isFollower, inFanclub: !!o.inFanclub,
    isMod: false, isOwner: !!o.isOwner, isSilenced: false, inPrivateShow: false, isSpying: false,
    isBroadcasting: false, language: 'en', gender: o.gender ?? 'm', subgender: '', fcAutoRenew: false,
  });
  const ev = (method, object) => ({ method, id: `${Date.now()}-${++seq}`, object: { broadcaster: username, ...object } });

  function push(events) {
    for (const e of events) log.push(e.id ? e : { ...e, id: `${Date.now()}-${++seq}` });
    for (const w of waiters) w();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/sim/push') {
      let b = ''; for await (const c of req) b += c;
      push(JSON.parse(b)); res.end('ok'); return;
    }
    const m = url.pathname.match(/^\/events\/([^/]+)\/([^/]+)\/$/);
    if (!m) { res.writeHead(404); return res.end('{}'); }
    if (m[1] !== username || m[2] !== token) { res.writeHead(401); return res.end('{"status":"Unauthorized"}'); }
    const from = Number(url.searchParams.get('i') || 0);
    const timeout = Number(url.searchParams.get('timeout') ?? 10);
    const reply = () => {
      const events = log.slice(from, from + 50);
      const next = `${base}/events/${username}/${token}/?i=${from + events.length}&timeout=${timeout}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ events, nextUrl: next }));
    };
    if (log.length > from || timeout === 0) return reply();
    const done = () => { waiters.delete(done); clearTimeout(t); reply(); };
    const t = setTimeout(done, timeout * 1000);
    waiters.add(done);
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, eventsUrl: `${base}/events/${username}/${token}/`, push, ev, user, close: () => server.close() });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sim = await createSim({ port: Number(process.env.SIM_PORT || 8790) });
  console.log('sim Events API at', sim.eventsUrl);
}
