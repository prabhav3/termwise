-- Termwise initial schema.
-- Conventions:
--   * Every user-owned table has user_id uuid default auth.uid() and RLS scoped to auth.uid().
--   * Calendar dates the student thinks in (due dates, plan days) are `date` / `time` in the
--     student's own timezone (profiles.timezone). Only audit columns are timestamptz.
--   * Secrets (OAuth refresh tokens, LMS tokens) live in *_secrets tables that have RLS enabled
--     and NO policies, so only the service role (edge functions) can read them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users) — also holds planner settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'America/New_York',
  -- 0 = Sunday ... 6 = Saturday
  study_days smallint[] not null default '{0,1,2,3,4,5,6}',
  daily_capacity_minutes integer not null default 180 check (daily_capacity_minutes between 15 and 960),
  reading_pages_per_hour integer not null default 20 check (reading_pages_per_hour between 1 and 200),
  default_pages_per_chapter integer not null default 25 check (default_pages_per_chapter between 1 and 500),
  -- an assessment worth at least this % of its course grade is "high impact"
  high_impact_threshold numeric not null default 15 check (high_impact_threshold between 0 and 100),
  blackout_dates date[] not null default '{}',
  triage_notification_time time not null default '07:30',
  notifications_enabled boolean not null default true,
  pomodoro_focus_minutes integer not null default 25 check (pomodoro_focus_minutes between 5 and 120),
  pomodoro_break_minutes integer not null default 5 check (pomodoro_break_minutes between 1 and 60),
  -- secret token for the read-only iCal subscription feed (ics-feed function)
  ics_token uuid not null default gen_random_uuid() unique,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- terms (a semester / quarter / school year grouping)
-- ---------------------------------------------------------------------------
create table public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint terms_dates check (start_date is null or end_date is null or start_date <= end_date)
);
create index terms_user_idx on public.terms (user_id);
create trigger terms_updated_at before update on public.terms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term_id uuid references public.terms (id) on delete set null,
  code text,
  title text not null,
  section text,
  instructor text,
  instructor_email text,
  color text not null default '#5B5BD6',
  credits numeric check (credits is null or credits >= 0),
  meeting_days smallint[] not null default '{}',
  meeting_start time,
  meeting_end time,
  location text,
  start_date date,
  end_date date,
  target_percent numeric check (target_percent is null or target_percent between 0 and 100),
  -- [{"letter":"A","min":93}, ...] sorted by min desc
  grade_scale jsonb not null default '[{"letter":"A","min":93},{"letter":"A-","min":90},{"letter":"B+","min":87},{"letter":"B","min":83},{"letter":"B-","min":80},{"letter":"C+","min":77},{"letter":"C","min":73},{"letter":"C-","min":70},{"letter":"D+","min":67},{"letter":"D","min":63},{"letter":"D-","min":60},{"letter":"F","min":0}]'::jsonb,
  -- {"late_policy": text|null, "unannounced_quizzes": bool, "attendance_policy": text|null,
  --  "drop_policy": text|null, "extra_credit": text|null}
  policies jsonb not null default '{}'::jsonb,
  canvas_course_id text,
  shared_from_slug text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_user_idx on public.courses (user_id);
create index courses_term_idx on public.courses (term_id);
create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- term_events: holidays, breaks, no-class days, finals period (merged across syllabi)
-- ---------------------------------------------------------------------------
create table public.term_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term_id uuid references public.terms (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  title text not null,
  kind text not null default 'other'
    check (kind in ('holiday', 'break', 'no_class', 'finals_period', 'add_drop', 'other')),
  start_date date not null,
  end_date date not null,
  source text not null default 'manual' check (source in ('ai', 'manual', 'shared', 'canvas')),
  created_at timestamptz not null default now(),
  constraint term_events_dates check (start_date <= end_date)
);
create index term_events_user_idx on public.term_events (user_id, start_date);

-- ---------------------------------------------------------------------------
-- grading_components: syllabus grading breakdown ("Midterm 25%", "Quizzes 15%, drop lowest")
-- ---------------------------------------------------------------------------
create table public.grading_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  weight numeric not null check (weight >= 0 and weight <= 100),
  expected_count integer check (expected_count is null or expected_count >= 0),
  drop_lowest integer not null default 0 check (drop_lowest >= 0),
  source text not null default 'manual' check (source in ('ai', 'manual', 'shared', 'canvas')),
  canvas_group_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index grading_components_course_idx on public.grading_components (course_id);
create trigger grading_components_updated_at before update on public.grading_components
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- textbooks: chapter -> page map so "Read ch. 4-7" becomes a page count
-- ---------------------------------------------------------------------------
create table public.textbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  authors text,
  -- [{"number":"4","title":"Memory","start_page":101,"end_page":134}]
  chapters jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index textbooks_course_idx on public.textbooks (course_id);
create trigger textbooks_updated_at before update on public.textbooks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- items: every assessment / assignment / reading parsed from a syllabus, Canvas, or entered
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  component_id uuid references public.grading_components (id) on delete set null,
  title text not null,
  kind text not null default 'other'
    check (kind in ('exam', 'quiz', 'paper', 'project', 'homework', 'reading',
                    'presentation', 'lab', 'discussion', 'other')),
  description text,
  assigned_date date,
  due_date date,               -- null = TBD / unscheduled
  due_time time,               -- null = all day / unspecified
  weight_override numeric check (weight_override is null or (weight_override >= 0 and weight_override <= 100)),
  points_possible numeric check (points_possible is null or points_possible >= 0),
  score numeric,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  -- {"textbook_id": uuid|null, "chapters": ["4","5"], "page_ranges": [{"start":101,"end":140}],
  --  "explicit_pages": int|null, "description": text|null}
  reading jsonb,
  pages integer check (pages is null or pages >= 0),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'missed')),
  high_impact_override boolean,        -- null = let the engine decide
  is_major boolean not null default false,
  source text not null default 'manual' check (source in ('ai', 'manual', 'shared', 'canvas', 'lms')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_quote text,
  notes text,
  canvas_assignment_id text,
  lms_due_at timestamptz,
  lms_lock_at timestamptz,
  lms_unlock_at timestamptz,
  -- pending change detected by two-way calendar sync, awaiting the student's decision:
  -- {"provider":"google","new_due_date":"2026-11-03","new_due_time":null,"detected_at":"..."}
  external_change jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_user_due_idx on public.items (user_id, due_date);
create index items_course_idx on public.items (course_id);
create unique index items_canvas_unique on public.items (user_id, canvas_assignment_id)
  where canvas_assignment_id is not null;
create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- syllabus_uploads: one parse job (syllabus file(s), pasted text, Canvas syllabus, or textbook TOC)
-- ---------------------------------------------------------------------------
create table public.syllabus_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  kind text not null default 'syllabus' check (kind in ('syllabus', 'toc')),
  source text not null default 'upload' check (source in ('upload', 'paste', 'canvas')),
  -- [{"path":"<user_id>/<upload_id>/0.pdf","mime":"application/pdf","name":"PSY101.pdf","size":12345}]
  files jsonb not null default '[]'::jsonb,
  pasted_text text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'needs_review', 'imported', 'failed')),
  progress_note text,
  error text,
  extraction jsonb,            -- SyllabusExtraction | TocExtraction (supabase/functions/_shared/extraction.ts)
  model text,
  usage jsonb,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index syllabus_uploads_user_idx on public.syllabus_uploads (user_id, created_at desc);
create trigger syllabus_uploads_updated_at before update on public.syllabus_uploads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- plan_blocks: the generated day-by-day work plan (paced reading, buffers, study sessions)
-- ---------------------------------------------------------------------------
create table public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  -- deterministic engine key, unique per user, stable across replans where possible
  key text not null,
  date date not null,
  minutes integer not null check (minutes > 0),
  kind text not null check (kind in ('reading', 'work', 'milestone', 'study', 'review')),
  label text not null,
  page_start integer,
  page_end integer,
  status text not null default 'planned' check (status in ('planned', 'done', 'missed', 'skipped')),
  sort_order integer not null default 0,
  generated_by text not null default 'engine' check (generated_by in ('engine', 'manual')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);
create index plan_blocks_user_date_idx on public.plan_blocks (user_id, date);
create index plan_blocks_item_idx on public.plan_blocks (item_id);
create trigger plan_blocks_updated_at before update on public.plan_blocks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- focus_sessions: pomodoro log
-- ---------------------------------------------------------------------------
create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  plan_block_id uuid references public.plan_blocks (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_minutes integer,
  focused_minutes integer not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index focus_sessions_user_idx on public.focus_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- calendar sync (Google / Microsoft server-side; Apple on-device via EventKit)
-- ---------------------------------------------------------------------------
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'apple')),
  account_email text,
  external_calendar_id text,     -- dedicated "Termwise" calendar we create
  task_list_id text,             -- Google Tasks list / Microsoft To Do list / Apple Reminders list
  delivery text not null default 'all_day_event' check (delivery in ('all_day_event', 'task')),
  sync_plan_blocks boolean not null default false,
  device_id text not null default '',   -- Apple: which device's EventKit store; '' for cloud providers
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'disconnected')),
  sync_cursor text,              -- provider incremental sync token / delta link
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, device_id)
);
create trigger calendar_connections_updated_at before update on public.calendar_connections
  for each row execute function public.set_updated_at();

create table public.calendar_secrets (
  connection_id uuid primary key references public.calendar_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

-- key = 'item:<item uuid>' or 'block:<plan_blocks.key>'
create table public.calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  key text not null,
  external_id text not null,
  external_kind text not null default 'event' check (external_kind in ('event', 'task')),
  pushed_hash text,
  pushed_date date,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, key)
);

-- ---------------------------------------------------------------------------
-- LMS (Canvas full import + generic iCal feeds for Blackboard / Moodle / others)
-- ---------------------------------------------------------------------------
create table public.lms_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('canvas', 'moodle', 'blackboard', 'ics')),
  base_url text not null,        -- Canvas: https://school.instructure.com ; ics: the feed URL host
  display_name text,
  external_user_id text,
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'disconnected')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, base_url)
);
create trigger lms_connections_updated_at before update on public.lms_connections
  for each row execute function public.set_updated_at();

create table public.lms_secrets (
  connection_id uuid primary key references public.lms_connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_enc text,                -- Canvas personal access token / OAuth access token
  refresh_token_enc text,
  feed_url_enc text,             -- private iCal feed URL (contains a secret)
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.lms_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  connection_id uuid not null references public.lms_connections (id) on delete cascade,
  external_id text not null,
  name text not null,
  course_code text,
  term_name text,
  start_at timestamptz,
  end_at timestamptz,
  has_syllabus boolean not null default false,
  linked_course_id uuid references public.courses (id) on delete set null,
  sync_enabled boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table public.lms_discrepancies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  connection_id uuid references public.lms_connections (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  kind text not null check (kind in ('date_mismatch', 'missing_in_lms', 'missing_in_syllabus',
                                     'locks_before_due', 'weight_mismatch', 'points_mismatch')),
  title text not null,
  detail text,
  syllabus_value text,
  lms_value text,
  lms_external_id text,
  -- stable identity so re-syncs update instead of duplicating
  dedupe_key text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, dedupe_key)
);
create trigger lms_discrepancies_updated_at before update on public.lms_discrepancies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shared_timelines: study-group share links (sanitized snapshot, no grades or notes)
-- ---------------------------------------------------------------------------
create table public.shared_timelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null unique references public.courses (id) on delete cascade,
  -- 12 hex chars (48 random bits) from core gen_random_uuid(); Supabase keeps pgcrypto's
  -- gen_random_bytes in the `extensions` schema, which migrations don't search.
  slug text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  snapshot jsonb not null,
  revoked boolean not null default false,
  import_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger shared_timelines_updated_at before update on public.shared_timelines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.terms enable row level security;
alter table public.courses enable row level security;
alter table public.term_events enable row level security;
alter table public.grading_components enable row level security;
alter table public.textbooks enable row level security;
alter table public.items enable row level security;
alter table public.syllabus_uploads enable row level security;
alter table public.plan_blocks enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_secrets enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.lms_connections enable row level security;
alter table public.lms_secrets enable row level security;
alter table public.lms_courses enable row level security;
alter table public.lms_discrepancies enable row level security;
alter table public.shared_timelines enable row level security;

-- profiles: created by trigger; users read/update their own row
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- simple owner-only tables
create policy terms_owner on public.terms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy courses_owner on public.courses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (term_id is null or exists (
      select 1 from public.terms t where t.id = term_id and t.user_id = (select auth.uid())))
  );

create policy syllabus_uploads_owner on public.syllabus_uploads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (course_id is null or exists (
      select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())))
  );

create policy focus_sessions_owner on public.focus_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy calendar_connections_owner on public.calendar_connections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy calendar_event_links_owner on public.calendar_event_links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.calendar_connections cc
                where cc.id = connection_id and cc.user_id = (select auth.uid()))
  );

-- LMS connections are created by the edge function (it has to validate the token first);
-- students can read, rename, and delete (disconnect) them.
create policy lms_connections_select on public.lms_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy lms_connections_update on public.lms_connections for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy lms_connections_delete on public.lms_connections for delete to authenticated
  using (user_id = (select auth.uid()));

create policy lms_courses_select on public.lms_courses for select to authenticated
  using (user_id = (select auth.uid()));
create policy lms_courses_update on public.lms_courses for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (linked_course_id is null or exists (
      select 1 from public.courses c where c.id = linked_course_id and c.user_id = (select auth.uid())))
  );

create policy lms_discrepancies_select on public.lms_discrepancies for select to authenticated
  using (user_id = (select auth.uid()));
create policy lms_discrepancies_update on public.lms_discrepancies for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy lms_discrepancies_delete on public.lms_discrepancies for delete to authenticated
  using (user_id = (select auth.uid()));

-- course-scoped tables: the referenced course must belong to the caller too
create policy term_events_owner on public.term_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (course_id is null or exists (
      select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid())))
    and (term_id is null or exists (
      select 1 from public.terms t where t.id = term_id and t.user_id = (select auth.uid())))
  );

create policy grading_components_owner on public.grading_components for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid()))
  );

create policy textbooks_owner on public.textbooks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid()))
  );

create policy items_owner on public.items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.courses c where c.id = course_id and c.user_id = (select auth.uid()))
    and (component_id is null or exists (
      select 1 from public.grading_components g
      where g.id = component_id and g.user_id = (select auth.uid()) and g.course_id = items.course_id))
  );

create policy plan_blocks_owner on public.plan_blocks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i
                where i.id = item_id and i.user_id = (select auth.uid()) and i.course_id = plan_blocks.course_id)
  );

-- share links: owners manage their own; everyone else goes through the RPCs below
create policy shared_timelines_owner_select on public.shared_timelines for select to authenticated
  using (owner_id = (select auth.uid()));
create policy shared_timelines_owner_update on public.shared_timelines for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy shared_timelines_owner_delete on public.shared_timelines for delete to authenticated
  using (owner_id = (select auth.uid()));

-- secrets: no policies on purpose (service role only), and no table privileges either
revoke all on public.calendar_secrets from anon, authenticated;
revoke all on public.lms_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: study-group share links
-- ---------------------------------------------------------------------------
create or replace function public.create_share_link(p_course_id uuid)
returns public.shared_timelines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_course public.courses;
  v_snapshot jsonb;
  v_row public.shared_timelines;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_course from public.courses where id = p_course_id and user_id = v_uid;
  if not found then
    raise exception 'course not found' using errcode = 'P0002';
  end if;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'course', jsonb_build_object(
      'title', v_course.title,
      'code', v_course.code,
      'section', v_course.section,
      'instructor', v_course.instructor,
      'credits', v_course.credits,
      'color', v_course.color,
      'meeting_days', to_jsonb(v_course.meeting_days),
      'meeting_start', v_course.meeting_start,
      'meeting_end', v_course.meeting_end,
      'location', v_course.location,
      'start_date', v_course.start_date,
      'end_date', v_course.end_date,
      'grade_scale', v_course.grade_scale,
      'policies', v_course.policies
    ),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', g.id, 'name', g.name, 'weight', g.weight,
               'expected_count', g.expected_count, 'drop_lowest', g.drop_lowest)
             order by g.sort_order, g.name)
      from public.grading_components g where g.course_id = p_course_id), '[]'::jsonb),
    'textbooks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', t.id, 'title', t.title, 'authors', t.authors, 'chapters', t.chapters))
      from public.textbooks t where t.course_id = p_course_id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', i.title, 'kind', i.kind, 'description', i.description,
               'assigned_date', i.assigned_date, 'due_date', i.due_date, 'due_time', i.due_time,
               'component_ref', i.component_id, 'weight_override', i.weight_override,
               'points_possible', i.points_possible, 'estimated_minutes', i.estimated_minutes,
               'reading', i.reading, 'pages', i.pages, 'is_major', i.is_major)
             order by i.due_date nulls last, i.title)
      from public.items i where i.course_id = p_course_id), '[]'::jsonb),
    'term_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', e.title, 'kind', e.kind, 'start_date', e.start_date, 'end_date', e.end_date)
             order by e.start_date)
      from public.term_events e where e.course_id = p_course_id), '[]'::jsonb)
  );

  insert into public.shared_timelines (owner_id, course_id, snapshot)
  values (v_uid, p_course_id, v_snapshot)
  on conflict (course_id) do update
    set snapshot = excluded.snapshot, revoked = false, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Public read of a share link (works signed-out, for the web preview and the import screen).
create or replace function public.get_shared_timeline(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', s.slug,
    'snapshot', s.snapshot,
    'import_count', s.import_count,
    'updated_at', s.updated_at
  )
  from public.shared_timelines s
  where s.slug = p_slug and not s.revoked;
$$;

-- Clone a shared timeline into the caller's account. Returns the new course id.
create or replace function public.import_shared_timeline(p_slug text, p_term_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_share public.shared_timelines;
  v_snap jsonb;
  v_c jsonb;
  v_course_id uuid;
  v_row jsonb;
  v_new uuid;
  v_comp_map jsonb := '{}'::jsonb;
  v_tb_map jsonb := '{}'::jsonb;
  v_reading jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_term_id is not null and not exists (
    select 1 from public.terms where id = p_term_id and user_id = v_uid) then
    raise exception 'term not found' using errcode = 'P0002';
  end if;

  select * into v_share from public.shared_timelines where slug = p_slug and not revoked;
  if not found then
    raise exception 'share link not found' using errcode = 'P0002';
  end if;
  v_snap := v_share.snapshot;
  v_c := v_snap -> 'course';

  insert into public.courses (
    user_id, term_id, code, title, section, instructor, credits, color, meeting_days,
    meeting_start, meeting_end, location, start_date, end_date, grade_scale, policies, shared_from_slug)
  values (
    v_uid, p_term_id, v_c ->> 'code', coalesce(v_c ->> 'title', 'Shared course'), v_c ->> 'section',
    v_c ->> 'instructor', (v_c ->> 'credits')::numeric, coalesce(v_c ->> 'color', '#5B5BD6'),
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(
                coalesce(v_c -> 'meeting_days', '[]'::jsonb)) as x), '{}'::smallint[]),
    (v_c ->> 'meeting_start')::time, (v_c ->> 'meeting_end')::time, v_c ->> 'location',
    (v_c ->> 'start_date')::date, (v_c ->> 'end_date')::date,
    coalesce(v_c -> 'grade_scale', '[]'::jsonb), coalesce(v_c -> 'policies', '{}'::jsonb), p_slug)
  returning id into v_course_id;

  for v_row in select value from jsonb_array_elements(coalesce(v_snap -> 'components', '[]'::jsonb)) loop
    insert into public.grading_components (user_id, course_id, name, weight, expected_count, drop_lowest, source)
    values (v_uid, v_course_id, v_row ->> 'name', coalesce((v_row ->> 'weight')::numeric, 0),
            (v_row ->> 'expected_count')::integer, coalesce((v_row ->> 'drop_lowest')::integer, 0), 'shared')
    returning id into v_new;
    v_comp_map := v_comp_map || jsonb_build_object(v_row ->> 'ref', v_new);
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_snap -> 'textbooks', '[]'::jsonb)) loop
    insert into public.textbooks (user_id, course_id, title, authors, chapters)
    values (v_uid, v_course_id, coalesce(v_row ->> 'title', 'Textbook'), v_row ->> 'authors',
            coalesce(v_row -> 'chapters', '[]'::jsonb))
    returning id into v_new;
    v_tb_map := v_tb_map || jsonb_build_object(v_row ->> 'ref', v_new);
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) loop
    v_reading := v_row -> 'reading';
    if v_reading is not null and jsonb_typeof(v_reading) = 'object' and v_reading ? 'textbook_id' then
      v_reading := jsonb_set(v_reading, '{textbook_id}',
                             coalesce(v_tb_map -> (v_reading ->> 'textbook_id'), 'null'::jsonb));
    elsif v_reading is not null and jsonb_typeof(v_reading) <> 'object' then
      v_reading := null;
    end if;

    insert into public.items (
      user_id, course_id, component_id, title, kind, description, assigned_date, due_date, due_time,
      weight_override, points_possible, estimated_minutes, reading, pages, is_major, source)
    values (
      v_uid, v_course_id, (v_comp_map ->> (v_row ->> 'component_ref'))::uuid,
      coalesce(v_row ->> 'title', 'Untitled'), coalesce(v_row ->> 'kind', 'other'), v_row ->> 'description',
      (v_row ->> 'assigned_date')::date, (v_row ->> 'due_date')::date, (v_row ->> 'due_time')::time,
      (v_row ->> 'weight_override')::numeric, (v_row ->> 'points_possible')::numeric,
      (v_row ->> 'estimated_minutes')::integer, v_reading, (v_row ->> 'pages')::integer,
      coalesce((v_row ->> 'is_major')::boolean, false), 'shared');
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_snap -> 'term_events', '[]'::jsonb)) loop
    insert into public.term_events (user_id, term_id, course_id, title, kind, start_date, end_date, source)
    values (v_uid, p_term_id, v_course_id, v_row ->> 'title', coalesce(v_row ->> 'kind', 'other'),
            (v_row ->> 'start_date')::date, (v_row ->> 'end_date')::date, 'shared');
  end loop;

  update public.shared_timelines set import_count = import_count + 1 where id = v_share.id;

  return v_course_id;
end;
$$;

revoke execute on function public.create_share_link(uuid) from public, anon;
revoke execute on function public.get_shared_timeline(text) from public;
revoke execute on function public.import_shared_timeline(text, uuid) from public, anon;
grant execute on function public.create_share_link(uuid) to authenticated;
grant execute on function public.get_shared_timeline(text) to anon, authenticated;
grant execute on function public.import_shared_timeline(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for syllabus files, foldered by user id
-- object names: <user_id>/<upload_id>/<n>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'syllabi', 'syllabi', false, 31457280,
  array['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain']
)
on conflict (id) do nothing;

create policy syllabi_select on storage.objects for select to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy syllabi_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy syllabi_update on storage.objects for update to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy syllabi_delete on storage.objects for delete to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Realtime: the app watches parse-job status changes
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.syllabus_uploads;
