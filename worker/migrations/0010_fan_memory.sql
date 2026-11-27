-- Fan memory: a short running memory per fan, rewritten by Claude after each stream from what the fan
-- said in that stream. Replaces nothing. The one-line note (0003) stays until memory is proven live.

alter table fans add column if not exists memory text;
alter table fans add column if not exists memory_at timestamptz;

-- This stream's public chat lines for a fan, held only until the memory is written, then cleared.
-- Filled only when the performer has AI notes switched on.
alter table session_fans add column if not exists chat_lines jsonb not null default '[]'::jsonb;

-- One row per call to Claude: what it was for and how it went. Holds no chat text and no memory text.
create table if not exists ai_calls (
  id             bigserial primary key,
  performer_id   uuid not null references performers(id) on delete cascade,
  session_id     uuid,
  username       text,
  skill          text not null,
  model          text,
  stop_reason    text,
  input_tokens   int,
  output_tokens  int,
  ms             int,
  used           boolean not null,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists ai_calls_by_performer on ai_calls (performer_id, created_at desc);
