-- Marks a stream StreamWing started watching partway through, so it never counts as a fully watched stream.
alter table sessions add column if not exists joined_mid_stream boolean not null default false;
