// Turns one Chaturbate event into fan memory, session stats and panel callouts.
// Everything for one event happens in one transaction, so a crash never half-counts a tip.
import { config } from './config.js';

const FAN_COLS = `username, first_seen, last_seen, visits, visit_days, total_tips, tip_count, biggest_tip,
  first_tip_at, last_tip_at, color_group, recent_tips, has_tokens, is_follower, in_fanclub, is_mod,
  language, last_message, last_message_at, messages_count, note, note_at`;

export const isLightBlue = fan => !!fan && fan.has_tokens === true && Number(fan.total_tips) === 0;

async function openSession(c, performerId) {
  const r = await c.query(`select * from sessions where performer_id=$1 and ended_at is null order by started_at desc limit 1`, [performerId]);
  if (r.rows[0]) return { session: r.rows[0], opened: false };
  const n = await c.query(`insert into sessions (performer_id) values ($1) returning *`, [performerId]);
  return { session: n.rows[0], opened: true };
}

async function closeSession(c, performerId) {
  const r = await c.query(
    `update sessions set ended_at=now() where performer_id=$1 and ended_at is null returning *`, [performerId]);
  return r.rows[0] || null;
}

// Copies what Chaturbate tells us about the viewer right now onto their fan record.
async function touchFan(c, performerId, u) {
  const r = await c.query(
    `insert into fans (performer_id, username, color_group, recent_tips, has_tokens, is_follower, in_fanclub, is_mod, language, gender)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (performer_id, username) do update set
       color_group = coalesce(excluded.color_group, fans.color_group),
       recent_tips = coalesce(excluded.recent_tips, fans.recent_tips),
       has_tokens  = coalesce(excluded.has_tokens, fans.has_tokens),
       is_follower = coalesce(excluded.is_follower, fans.is_follower),
       in_fanclub  = coalesce(excluded.in_fanclub, fans.in_fanclub),
       is_mod      = coalesce(excluded.is_mod, fans.is_mod),
       language    = coalesce(excluded.language, fans.language),
       gender      = coalesce(excluded.gender, fans.gender)
     returning ${FAN_COLS}, (xmax = 0) as inserted`,
    [performerId, u.username, u.colorGroup, u.recentTips, u.hasTokens, u.isFollower, u.inFanclub, u.isMod, u.language, u.gender]);
  return r.rows[0];
}

async function getFan(c, performerId, username) {
  const r = await c.query(`select ${FAN_COLS} from fans where performer_id=$1 and username=$2`, [performerId, username]);
  return r.rows[0] || null;
}

async function addFeed(c, performerId, sessionId, kind, username, data) {
  const r = await c.query(
    `insert into feed (performer_id, session_id, kind, username, data) values ($1,$2,$3,$4,$5) returning id, session_id, kind, username, data, created_at`,
    [performerId, sessionId, kind, username, data]);
  return r.rows[0];
}

// Decides what the performer should notice when someone walks in.
export function enterCallout(fanBefore, fanAfter, isFirstVisit) {
  const total = Number(fanAfter.total_tips);
  if (isFirstVisit) return fanAfter.has_tokens ? 'new_with_tokens' : 'new_viewer';
  if (total >= config.bigTipperTokens) return 'big_tipper_back';
  if (total > 0) return 'tipper_back';
  if (fanAfter.visit_days >= config.regularDays) return 'regular_back';
  if (fanAfter.has_tokens) return 'light_blue_back';
  return 'returning';
}

// Main entry. Returns { duplicate } or { items: [feed rows], fan }.
export async function processEvent(c, performer, ev) {
  const pid = performer.id;
  const uname = ev.user?.username || null;

  // Private messages are hers. We keep that one happened, never what it said.
  const payload = ev.method === 'privateMessage'
    ? { method: ev.method, id: ev.raw.id, object: { broadcaster: ev.broadcaster, user: ev.raw.object?.user, message: '[not stored]' } }
    : ev.raw;
  const ins = await c.query(
    `insert into events (performer_id, cb_event_id, method, username, payload)
     values ($1,$2,$3,$4,$5) on conflict (performer_id, cb_event_id) do nothing returning id`,
    [pid, ev.id, ev.method, uname, payload]);
  if (!ins.rows[0]) return { duplicate: true };

  const items = [];
  const isOwner = !uname || ev.user?.isOwner || uname.toLowerCase() === performer.cb_username.toLowerCase();

  if (ev.method === 'broadcastStart') {
    await closeSession(c, pid);
    const { session } = await openSession(c, pid);
    items.push(await addFeed(c, pid, session.id, 'live', null, {}));
    return { items };
  }

  if (ev.method === 'broadcastStop') {
    const ended = await closeSession(c, pid);
    if (ended) items.push(await addFeed(c, pid, ended.id, 'recap', null, await buildRecap(c, ended)));
    return { items };
  }

  if (ev.method === 'roomSubjectChange' || isOwner) return { items };

  // Any viewer activity means she's live, even if we connected mid-stream.
  const { session, opened } = await openSession(c, pid);
  if (opened) items.push(await addFeed(c, pid, session.id, 'live', null, { joinedMidStream: true }));
  const sid = session.id;

  const before = await getFan(c, pid, uname);
  let fan = await touchFan(c, pid, ev.user);

  const newToRoom = !before || before.visits === 0;
  // Mark them as seen in this session, and count them the first time they show up in it.
  const seen = async (lightBlue) => {
    const r = await c.query(
      `insert into session_fans (session_id, username, was_light_blue) values ($1,$2,$3)
       on conflict (session_id, username) do update set in_room = true,
         was_light_blue = session_fans.was_light_blue or excluded.was_light_blue
       returning (xmax = 0) as inserted`, [sid, uname, lightBlue]);
    const inserted = r.rows[0].inserted;
    if (inserted) {
      await c.query(
        `update sessions set unique_visitors = unique_visitors + 1,
           new_visitors = new_visitors + $2, returning_visitors = returning_visitors + $3,
           light_blues_seen = light_blues_seen + $4
         where id=$1`, [sid, newToRoom ? 1 : 0, newToRoom ? 0 : 1, lightBlue ? 1 : 0]);
    }
    return inserted;
  };

  switch (ev.method) {
    case 'userEnter': {
      const firstVisit = newToRoom;
      const lastSeen = before ? new Date(before.last_seen) : null;
      const isRevisit = !firstVisit && lastSeen && (Date.now() - lastSeen.getTime()) < config.revisitMinutes * 60000;
      if (!isRevisit) {
        const r = await c.query(
          `update fans set visits = visits + 1, last_seen = now(),
             visit_days = visit_days + case when last_visit_day is distinct from current_date then 1 else 0 end,
             last_visit_day = current_date
           where performer_id=$1 and username=$2 returning ${FAN_COLS}`, [pid, uname]);
        fan = r.rows[0];
      } else {
        await c.query(`update fans set last_seen = now() where performer_id=$1 and username=$2`, [pid, uname]);
      }
      const lb = isLightBlue(fan);
      await seen(lb);
      await c.query(
        `update sessions s set peak_in_room = greatest(peak_in_room,
           (select count(*) from session_fans where session_id = s.id and in_room)) where id=$1`, [sid]);
      if (!isRevisit) {
        const kind = enterCallout(before, fan, firstVisit);
        items.push(await addFeed(c, pid, sid, kind, uname, { fan, lightBlue: lb }));
      }
      break;
    }

    case 'userLeave':
      await c.query(`update session_fans set in_room = false where session_id=$1 and username=$2`, [sid, uname]);
      await c.query(`update fans set last_seen = now() where performer_id=$1 and username=$2`, [pid, uname]);
      items.push({ kind: 'leave', username: uname, data: {}, transient: true });
      break;

    case 'tip': {
      const tokens = ev.tip?.tokens || 0;
      const wasLightBlue = isLightBlue(before || fan);
      const firstTipEver = !before || Number(before.tip_count) === 0;
      const r = await c.query(
        `update fans set total_tips = total_tips + $3, tip_count = tip_count + 1,
           biggest_tip = greatest(biggest_tip, $3), last_tip_at = now(),
           first_tip_at = coalesce(first_tip_at, now()), last_seen = now()
         where performer_id=$1 and username=$2 returning ${FAN_COLS}`, [pid, uname, tokens]);
      fan = r.rows[0];
      await seen(wasLightBlue);
      const sf = await c.query(
        `update session_fans set tipped = tipped + $3 where session_id=$1 and username=$2
         returning tipped - $3 as before, was_light_blue`, [sid, uname, tokens]);
      const firstTipThisSession = Number(sf.rows[0].before) === 0;
      const converted = firstTipThisSession && sf.rows[0].was_light_blue && firstTipEver;
      await c.query(
        `update sessions set tokens = tokens + $2, tippers = tippers + $3, light_blues_converted = light_blues_converted + $4 where id=$1`,
        [sid, tokens, firstTipThisSession ? 1 : 0, converted ? 1 : 0]);
      items.push(await addFeed(c, pid, sid, firstTipEver ? 'first_tip' : 'tip', uname,
        { fan, tokens, message: ev.tip?.message || '', isAnon: !!ev.tip?.isAnon, converted }));
      break;
    }

    case 'mediaPurchase': {
      const tokens = ev.media?.tokens || 0;
      await seen(false);
      await c.query(`update sessions set tokens = tokens + $2 where id=$1`, [sid, tokens]);
      items.push(await addFeed(c, pid, sid, 'media', uname, { fan, tokens, name: ev.media?.name, type: ev.media?.type }));
      break;
    }

    case 'follow':
      await c.query(`update fans set is_follower = true where performer_id=$1 and username=$2`, [pid, uname]);
      await c.query(`update sessions set new_followers = new_followers + 1 where id=$1`, [sid]);
      fan = await getFan(c, pid, uname);
      items.push(await addFeed(c, pid, sid, 'follow', uname, { fan }));
      break;

    case 'unfollow':
      await c.query(`update fans set is_follower = false where performer_id=$1 and username=$2`, [pid, uname]);
      break;

    case 'fanclubJoin':
      await c.query(`update fans set in_fanclub = true where performer_id=$1 and username=$2`, [pid, uname]);
      await c.query(`update sessions set fanclub_joins = fanclub_joins + 1 where id=$1`, [sid]);
      fan = await getFan(c, pid, uname);
      items.push(await addFeed(c, pid, sid, 'fanclub', uname, { fan }));
      break;

    case 'chatMessage': {
      const text = (ev.message?.message || '').slice(0, 500);
      const r = await c.query(
        `update fans set last_message = $3, last_message_at = now(), messages_count = messages_count + 1, last_seen = now(),
           recent_messages = (
             select coalesce(jsonb_agg(m order by i), '[]'::jsonb) from (
               select m, i from jsonb_array_elements(jsonb_build_array(jsonb_build_object('t', now(), 'm', $3::text)) || recent_messages)
               with ordinality as x(m, i) order by i limit 5) keep)
         where performer_id=$1 and username=$2 returning ${FAN_COLS}`, [pid, uname, text]);
      fan = r.rows[0];
      await seen(isLightBlue(fan));
      items.push({ kind: 'chat', username: uname, data: { fan, message: text }, transient: true });
      break;
    }

    default:
      // privateMessage and anything new: kept in the raw events table only.
      break;
  }
  return { items, fan };
}

export async function buildRecap(c, s) {
  const top = await c.query(
    `select username, tipped from session_fans where session_id=$1 and tipped > 0 order by tipped desc limit 5`, [s.id]);
  const converted = await c.query(
    `select sf.username from session_fans sf join fans f on f.performer_id=$2 and f.username=sf.username
     where sf.session_id=$1 and sf.was_light_blue and sf.tipped > 0 and f.tip_count >= 1
       and f.first_tip_at >= $3`, [s.id, s.performer_id, s.started_at]);
  const missed = await c.query(
    `select sf.username from session_fans sf where sf.session_id=$1 and sf.was_light_blue and sf.tipped = 0 limit 10`, [s.id]);
  const mins = Math.round((new Date(s.ended_at || Date.now()) - new Date(s.started_at)) / 60000);
  // The stream before this one, so she can see whether things moved.
  const prev = await c.query(
    `select * from sessions where performer_id=$1 and started_at < $2 and ended_at is not null order by started_at desc limit 1`,
    [s.performer_id, s.started_at]);
  const p = prev.rows[0];
  return {
    previous: p ? {
      startedAt: p.started_at, tokens: p.tokens, tippers: p.tippers, uniqueVisitors: p.unique_visitors,
      returningVisitors: p.returning_visitors, lightBluesSeen: p.light_blues_seen, lightBluesConverted: p.light_blues_converted,
      newFollowers: p.new_followers,
    } : null,
    minutes: mins,
    tokens: s.tokens, tippers: s.tippers,
    uniqueVisitors: s.unique_visitors, newVisitors: s.new_visitors, returningVisitors: s.returning_visitors,
    lightBluesSeen: s.light_blues_seen, lightBluesConverted: s.light_blues_converted,
    newFollowers: s.new_followers, fanclubJoins: s.fanclub_joins, peakInRoom: s.peak_in_room,
    topTippers: top.rows, convertedFans: converted.rows.map(r => r.username),
    lightBluesNotYet: missed.rows.map(r => r.username),
  };
}
