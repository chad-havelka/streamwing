-- Fan profiles: the last few things a fan said, and her own private note about them.
alter table fans add column if not exists recent_messages jsonb not null default '[]'::jsonb; -- newest first, max 5: [{"t": time, "m": text}]
alter table fans add column if not exists owner_note text;
alter table fans add column if not exists owner_note_at timestamptz;

-- Profile lookups: a fan's tips and the streams they were in.
create index if not exists events_tips_by_fan on events (performer_id, username, received_at desc) where method = 'tip';
create index if not exists session_fans_by_user on session_fans (username);
create index if not exists sessions_by_performer on sessions (performer_id, started_at desc);
