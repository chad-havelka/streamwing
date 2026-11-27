// The one-line note StreamWing writes about each fan, with Claude.
// Runs after a stream ends, for the fans who chatted or tipped in it. Off unless the performer turns it on
// (performers.ai_notes) and an API key is set.
// What's sent: the fan's username, their tips and visits with her, the last few things they said in
// her public chat, and her own note about them. Private messages are never stored, so never sent.
import { config } from './config.js';
import { q } from './db.js';

const SYSTEM = `You write one short line that helps a cam performer remember a fan the next time they walk into her room.
Use only the facts given. Never guess, never invent, never judge the fan.
Name the most useful thing to bring up with them: something they said, something they care about, or how they support her.
Plain words, no emojis, no quotes around the line, no sexual detail, at most 18 words.
If the facts are too thin to say anything useful, reply with exactly: SKIP`;

function factsFor(f) {
  const msgs = (f.recent_messages || []).map(m => m.m).filter(Boolean).slice(0, 5);
  return JSON.stringify({
    fan: f.username,
    days_in_her_room: f.visit_days,
    tokens_tipped_to_her: f.total_tips,
    biggest_tip: f.biggest_tip,
    in_her_fan_club: !!f.in_fanclub,
    follows_her: f.is_follower === true,
    has_tokens: f.has_tokens === true,
    recent_public_chat_newest_first: msgs,
    her_own_note: f.owner_note || null,
  });
}

export async function askClaude(facts) {
  const res = await fetch(`${config.aiBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.aiKey,
      'anthropic-version': config.aiVersion,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: config.aiModel, max_tokens: 80, system: SYSTEM, messages: [{ role: 'user', content: facts }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  return text.replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ').slice(0, 200);
}

// Writes notes for the fans who chatted or tipped in one stream. Never throws.
export async function writeNotesForSession(performerId, sessionId) {
  if (!config.aiKey) return { skipped: 'no key' };
  let on = false;
  try { on = !!(await q(`select ai_notes from performers where id=$1`, [performerId])).rows[0]?.ai_notes; }
  catch (e) { console.error('[ai]', e.message); return { skipped: 'error' }; }
  if (!on) return { skipped: 'off' };
  let written = 0;
  try {
    const r = await q(
      `select f.* from session_fans sf join fans f on f.performer_id=$1 and f.username = sf.username
       where sf.session_id=$2 and (sf.tipped > 0 or f.messages_count > 0 or f.owner_note is not null)
       order by f.total_tips desc, f.visit_days desc limit $3`, [performerId, sessionId, config.aiNotesPerStream]);
    for (const f of r.rows) {
      try {
        const line = await askClaude(factsFor(f));
        if (!line || line.toUpperCase() === 'SKIP') continue;
        await q(`update fans set note=$3, note_at=now() where performer_id=$1 and username=$2`, [performerId, f.username, line]);
        written++;
      } catch (e) {
        console.error('[ai] note failed for a fan:', e.message);
      }
    }
  } catch (e) {
    console.error('[ai]', e.message);
  }
  console.log(`[ai] wrote ${written} fan notes`);
  return { written };
}
