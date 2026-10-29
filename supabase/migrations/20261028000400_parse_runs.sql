-- One row per paid Claude parse, so parse-syllabus can cap runs per student per day.
-- Re-parsing the same upload overwrites syllabus_uploads.processing_started_at, so that
-- column can't be counted; this log is append-only and written by the service role only.
create table public.parse_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  upload_id uuid references public.syllabus_uploads (id) on delete set null,
  started_at timestamptz not null default now()
);
create index parse_runs_user_started_idx on public.parse_runs (user_id, started_at desc);

-- RLS on with no policies: students can neither read nor erase their run history.
alter table public.parse_runs enable row level security;
revoke all on public.parse_runs from anon, authenticated;
