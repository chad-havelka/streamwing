-- Performer research. Responses and voluntary contacts live in separate tables and are never joined.
-- A response holds no name, account name or IP address.

create table if not exists research_responses (
  id uuid primary key,
  survey_version text not null,
  status text not null check (status in ('in_progress', 'completed')),
  test boolean not null default false,
  consent_at timestamptz not null,
  answers jsonb not null default '{}'::jsonb,
  future_interest jsonb,
  last_question text,
  source text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists research_responses_status_idx on research_responses (status, started_at);

create table if not exists research_contacts (
  id uuid primary key default gen_random_uuid(),
  preferred_name text,
  contact_method text not null check (contact_method in ('email', 'other')),
  contact_value text not null,
  timezone text,
  activities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
