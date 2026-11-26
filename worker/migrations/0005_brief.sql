-- Her fans' birthdays, typed in by her on the fan card. Used by the daily brief.
alter table fans add column if not exists birthday date;
