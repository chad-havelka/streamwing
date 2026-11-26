// Talking to Chaturbate's Events API.
// Docs: the API is a long-poll JSON feed. Each response carries a batch of events
// and a nextUrl to call for the next batch.

// Accepts what a performer pastes: the full Events API URL Chaturbate shows her,
// e.g. https://eventsapi.chaturbate.com/events/<username>/<token>/
// Returns a clean base URL or throws with a message she can act on.
export function parseEventsUrl(input, expectedUsername) {
  const raw = String(input || '').trim();
  // A bare token works too: we already know whose room it is.
  if (expectedUsername && /^[A-Za-z0-9_-]{8,}$/.test(raw)) {
    return `https://eventsapi.chaturbate.com/events/${encodeURIComponent(expectedUsername)}/${raw}/`;
  }
  let u;
  try { u = new URL(raw); } catch { throw new Error('Paste the full Events API link from Chaturbate. It starts with https://'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.ALLOW_HTTP_EVENTS === '1')) throw new Error('The link has to start with https://');
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('events');
  if (i < 0 || parts.length < i + 3) {
    // Chaturbate's token page can also show a Stats API style link that carries the token
    // as ?token=... Pull the token out of that and build her Events API link from it.
    const token = u.searchParams.get('token');
    const who = u.searchParams.get('username') || expectedUsername;
    if (token && /^[A-Za-z0-9_-]{8,}$/.test(token) && who) {
      if (expectedUsername && who.toLowerCase() !== expectedUsername.toLowerCase()) {
        throw new Error(`That link is for ${who}, not ${expectedUsername}.`);
      }
      return `https://eventsapi.chaturbate.com/events/${encodeURIComponent(expectedUsername || who)}/${token}/`;
    }
    if (/\/statsapi\/authtoken/.test(u.pathname)) {
      throw new Error("That's the address of the token page itself. Click \"Generate auth token\" there, then copy the link that appears on the page.");
    }
    throw new Error("That doesn't look like the link from Chaturbate's token page. Copy the whole link that appears after you click \"Generate auth token\".");
  }
  const username = parts[i + 1];
  if (expectedUsername && username.toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error(`That link is for ${username}, not ${expectedUsername}.`);
  }
  if (!isChaturbateHost(u)) throw new Error("That link doesn't go to Chaturbate. Copy it again from Chaturbate's token page.");
  u.search = '';
  u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}

// Only Chaturbate's own Events hosts (live and testbed). Anything else could point us at someone else's server.
export const CB_EVENT_HOSTS = ['eventsapi.chaturbate.com', 'events.testbed.cb.dev'];
export function isChaturbateHost(u) {
  if (process.env.ALLOW_HTTP_EVENTS === '1') return true; // local test server only
  return u.protocol === 'https:' && CB_EVENT_HOSTS.includes(u.hostname.toLowerCase());
}

// A nextUrl is only followed when it stays on the same host as the link we called.
export function sameHost(nextUrl, currentUrl) {
  try { return new URL(nextUrl).origin === new URL(currentUrl).origin; } catch { return false; }
}

export function withTimeout(url, timeoutSec) {
  const u = new URL(url);
  if (!u.searchParams.has('timeout')) u.searchParams.set('timeout', String(timeoutSec));
  return u.toString();
}

export class CbError extends Error {
  constructor(status, body) {
    super(`Chaturbate answered ${status}`);
    this.status = status;
    this.body = body;
    // A 403 that comes back as a web page is Chaturbate's network blocking us, not a bad token.
    const blocked = status === 403 && /<html|cloudflare/i.test(body || '');
    this.blocked = blocked;
    this.auth = status === 401 || (status === 403 && !blocked);
    this.retryable = status === 429 || status >= 500 || this.blocked;
  }
}

// One long-poll request. Returns { events, nextUrl }.
export async function poll(url, timeoutSec) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (timeoutSec + 20) * 1000);
  try {
    const res = await fetch(withTimeout(url, timeoutSec), {
      signal: ctrl.signal,
      headers: { 'user-agent': 'StreamWing/0.1 (+https://streamwing.studio)' },
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new CbError(res.status, text.slice(0, 300));
      // When our saved place in the feed is too old, Chaturbate answers 400 with a fresh nextUrl
      // ("You waited too long. Please start over using nextUrl"). Keep it so the worker can restart from it.
      try { const b = JSON.parse(text); if (res.status === 400 && typeof b.nextUrl === 'string') err.restartUrl = b.nextUrl; } catch { /* not JSON */ }
      throw err;
    }
    let body;
    try { body = JSON.parse(text); } catch { throw new CbError(502, 'not JSON: ' + text.slice(0, 120)); }
    return { events: Array.isArray(body.events) ? body.events : [], nextUrl: body.nextUrl || null };
  } finally {
    clearTimeout(t);
  }
}

// Chaturbate sends camelCase. Normalize defensively so a renamed field doesn't crash us.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined) return o[k]; return undefined; };

export function normalizeUser(u) {
  if (!u) return null;
  return {
    // Chaturbate's docs call it `user`; client libraries see `username`. Accept either.
    username: pick(u, 'username', 'user') ?? null,
    colorGroup: pick(u, 'colorGroup', 'color_group') ?? null,
    hasTokens: pick(u, 'hasTokens', 'has_tokens') ?? null,
    recentTips: pick(u, 'recentTips', 'recent_tips') ?? null,
    isFollower: pick(u, 'isFollower', 'is_follower') ?? null,
    inFanclub: pick(u, 'inFanclub', 'in_fanclub') ?? null,
    isMod: pick(u, 'isMod', 'is_mod') ?? null,
    isOwner: pick(u, 'isOwner', 'is_owner') ?? false,
    language: pick(u, 'language') ?? null,
    gender: pick(u, 'gender') ?? null,
  };
}

export function normalizeEvent(e) {
  const o = e.object || {};
  const tip = o.tip ? { tokens: Number(pick(o.tip, 'tokens') || 0), isAnon: !!pick(o.tip, 'isAnon', 'is_anon'), message: pick(o.tip, 'message') || '' } : null;
  const msg = o.message ? { message: pick(o.message, 'message') || '', fromUser: pick(o.message, 'fromUser', 'from_user') || null, toUser: pick(o.message, 'toUser', 'to_user') || null } : null;
  const media = o.media ? { name: pick(o.media, 'name'), tokens: Number(pick(o.media, 'tokens') || 0), type: pick(o.media, 'type') } : null;
  return {
    id: String(e.id ?? ''),
    method: e.method,
    broadcaster: o.broadcaster || null,
    user: normalizeUser(o.user),
    tip, message: msg, media,
    subject: pick(o, 'subject') ?? null,
    raw: e,
  };
}

// A restart link is only trusted if it points at the same feed we were already reading.
export function restartFor(restartUrl, currentUrl) {
  try {
    const r = new URL(restartUrl), c = new URL(currentUrl);
    if (r.origin !== c.origin || r.pathname !== c.pathname) return null;
    r.searchParams.delete('timeout');
    return r.toString();
  } catch { return null; }
}
