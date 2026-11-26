-- StreamWing bot: core schema.
-- The worker is the only thing that reads or writes these tables.
-- The panel never talks to the database directly; it goes through the worker's API.

-- One row per performer account StreamWing watches.
create table if not exists performers (
  id               uuid primary key default gen_random_uuid(),
  cb_username      text not null unique,
  display_name     text,
  access_key_hash  text not null unique,   -- sha256 of the key in her /start link
  approved         boolean not null default true,
  cb_token_enc     text,                   -- AES-256-GCM, key lives only in the worker's env
  next_url_enc     text,                   -- Events API cursor (it contains the token, so it is encrypted too)
  connected_at     timestamptz,
  last_event_at    timestamptz,
  last_poll_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now()
);

-- Everything StreamWing remembers about one viewer in one performer's room.
create table if not exists fans (
  performer_id     uuid not null references performers(id) on delete cascade,
  username         text not null,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  visits           int not null default 0,   -- room entries, ignoring re-entries within 30 minutes
  visit_days       int not null default 0,   -- distinct days she's seen them
  last_visit_day   date,
  total_tips       int not null default 0,   -- tokens tipped to this performer, all time
  tip_count        int not null default 0,
  first_tip_at     timestamptz,
  last_tip_at      timestamptz,
  biggest_tip      int not null default 0,
  color_group      text,
  recent_tips      text,                     -- Chaturbate's own bucket: none, few, some, lots, tons
  has_tokens       boolean,
  is_follower      boolean,
  in_fanclub       boolean,
  is_mod           boolean,
  language         text,
  gender           text,
  last_message     text,
  last_message_at  timestamptz,
  messages_count   int not null default 0,
  note             text,                     -- AI-written one-liner (later)
  primary key (performer_id, username)
);

-- One row per broadcast.
create table if not exists sessions (
  id                     uuid primary key default gen_random_uuid(),
  performer_id           uuid not null references performers(id) on delete cascade,
  started_at             timestamptz not null default now(),
  ended_at               timestamptz,
  unique_visitors        int not null default 0,
  new_visitors           int not null default 0,
  returning_visitors     int not null default 0,
  tippers                int not null default 0,
  tokens                 int not null default 0,
  light_blues_seen       int not null default 0,
  light_blues_converted  int not null default 0,
  new_followers          int not null default 0,
  fanclub_joins          int not null default 0,
  peak_in_room           int not null default 0
);
create index if not exists sessions_open on sessions (performer_id) where ended_at is null;

-- Who was seen in which session (for unique counts and the recap).
create table if not exists session_fans (
  session_id     uuid not null references sessions(id) on delete cascade,
  username       text not null,
  tipped         int not null default 0,
  in_room        boolean not null default true,
  was_light_blue boolean not null default false,
  primary key (session_id, username)
);

-- Raw events, exactly as Chaturbate sent them. Deduplicated on Chaturbate's event id.
create table if not exists events (
  id            bigserial primary key,
  performer_id  uuid not null references performers(id) on delete cascade,
  cb_event_id   text not null,
  method        text not null,
  username      text,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  unique (performer_id, cb_event_id)
);
create index if not exists events_by_performer on events (performer_id, received_at desc);

-- What the panel shows: callouts and feed items, already worked out by the worker.
create table if not exists feed (
  id            bigserial primary key,
  performer_id  uuid not null references performers(id) on delete cascade,
  session_id    uuid references sessions(id) on delete set null,
  kind          text not null,
  username      text,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists feed_by_performer on feed (performer_id, id desc);
