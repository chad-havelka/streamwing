-- When the worker last started reading her Events API feed from a fresh place (connect, or a saved place that was
-- too old). A broadcastStop seen after this means she is offline until the next broadcastStart.
alter table performers add column if not exists feed_started_at timestamptz;
update performers set feed_started_at = connected_at where feed_started_at is null;
