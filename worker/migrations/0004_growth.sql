-- Growth dashboard and daily brief: messages per stream (a count, never the text) and her time zone for counting days.
alter table sessions add column if not exists messages int not null default 0;
alter table performers add column if not exists timezone text;
