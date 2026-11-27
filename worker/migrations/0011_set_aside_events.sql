-- An event the worker could not store is set aside here and the room carries on.
-- Holds which event and why. The event's own content is not kept: it may be the part that cannot be stored.
create table if not exists set_aside_events (
  id            bigserial primary key,
  performer_id  uuid not null references performers(id) on delete cascade,
  cb_event_id   text not null,
  method        text,
  username      text,
  error         text not null,
  created_at    timestamptz not null default now(),
  unique (performer_id, cb_event_id)
);
