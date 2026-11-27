-- The performer's own switch for AI fan notes. Off until she turns it on.
alter table performers add column if not exists ai_notes boolean not null default false;
