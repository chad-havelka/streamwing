-- When StreamWing last wrote its one-line note about a fan.
alter table fans add column if not exists note_at timestamptz;
