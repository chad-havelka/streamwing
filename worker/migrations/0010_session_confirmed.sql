-- Whether Chaturbate confirmed she was broadcasting during this stream: a broadcastStart opened it, or a broadcastStop
-- closed it. A stream opened from viewer activity alone stays unconfirmed, because after a feed gap a late chat from an
-- ended stream looks the same as the first chat of a stream whose broadcastStart was missed. Analytics use confirmed streams.
alter table sessions add column if not exists confirmed boolean not null default true;
-- Earlier streams opened from viewer activity (a "joined mid-stream" card) and never closed by a stop (no recap) were unconfirmed.
update sessions s set confirmed = false
 where exists (select 1 from feed f where f.session_id = s.id and f.kind = 'live' and f.data->>'joinedMidStream' = 'true')
   and not exists (select 1 from feed f where f.session_id = s.id and f.kind = 'recap');
