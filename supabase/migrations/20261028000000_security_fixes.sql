-- Security and data-integrity hardening.
--   1. calendar_oauth_pending: one-time Google / Microsoft consent flows (state nonce + PKCE
--      verifier), so a consent can only be attached to the Termwise account that started it.
--   2. apple_secrets: the Sign in with Apple refresh token, revoked on account deletion.
--   3. shared_timelines: owners may change only `revoked`; rows hijacked through the old
--      all-columns UPDATE policy are removed.
--   4. create_share_link: sharing again after "Stop sharing" issues a new slug, and never
--      updates a row the caller doesn't own.
--   5. import_shared_timeline: rebuilds every JSON value from known, type-checked keys instead of
--      copying the sharer's JSON into the importer's account.

-- ---------------------------------------------------------------------------
-- 1. calendar OAuth flows in progress (service role only, like the *_secrets tables)
-- ---------------------------------------------------------------------------
-- calendar-oauth-start inserts the row; calendar-oauth-callback claims it once (used_at), stores
-- the sealed tokens and the hash of a one-time finish code; calendar-oauth-finish (user auth)
-- deletes it and creates the connection only for user_id.
create table public.calendar_oauth_pending (
  nonce text primary key,                 -- the signed state's nonce
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  code_verifier text not null,            -- PKCE (S256) verifier; the challenge went to the provider
  expires_at timestamptz not null,
  used_at timestamptz,                    -- set when the provider's redirect claims the row
  finish_code_hash text unique,           -- sha256 of the code handed to the app's return_url
  account_email text,
  access_token_enc text,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now()
);
create index calendar_oauth_pending_user_idx on public.calendar_oauth_pending (user_id);
create index calendar_oauth_pending_expires_idx on public.calendar_oauth_pending (expires_at);
alter table public.calendar_oauth_pending enable row level security;
revoke all on public.calendar_oauth_pending from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sign in with Apple refresh token (service role only)
-- ---------------------------------------------------------------------------
create table public.apple_secrets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token_enc text not null,
  updated_at timestamptz not null default now()
);
alter table public.apple_secrets enable row level security;
revoke all on public.apple_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. shared_timelines: the app only ever flips `revoked` ("Stop sharing")
-- ---------------------------------------------------------------------------
-- The row policy still scopes updates to the owner; column privileges keep course_id, slug,
-- snapshot, owner_id and import_count server-managed (create_share_link / import_shared_timeline).
revoke insert, update on public.shared_timelines from anon, authenticated;
grant update (revoked) on public.shared_timelines to authenticated;

-- A share row pointing at a course its owner doesn't own could only come from rewriting
-- course_id through the old policy: drop it (the course owner can share again).
delete from public.shared_timelines s
where not exists (
  select 1 from public.courses c where c.id = s.course_id and c.user_id = s.owner_id
);

-- ---------------------------------------------------------------------------
-- 4. create_share_link
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

  -- Re-sharing after "Stop sharing" gets a fresh slug, so the old (possibly leaked) link stays
  -- dead. 12 hex characters of a v4 UUID's random bits, like the column default's 6 random bytes.
  insert into public.shared_timelines as s (owner_id, course_id, snapshot)
  values (v_uid, p_course_id, v_snapshot)
  on conflict (course_id) do update
    set snapshot = excluded.snapshot,
        revoked = false,
        updated_at = now(),
        slug = case when s.revoked
                    then substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
                    else s.slug end
    where s.owner_id = v_uid
  returning * into v_row;
  if not found then
    raise exception 'share link belongs to another account';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. import_shared_timeline: sanitizers for the snapshot's JSON values
-- ---------------------------------------------------------------------------
-- Every value is rebuilt from the keys the app's types define (src/types/db.ts), keeping a field
-- only when its JSON type is right, so a hand-edited row or snapshot can't plant a value that
-- breaks the importer's planner.

-- items.reading (ReadingRef). Null when the value isn't an object; textbook_id is remapped
-- through p_textbook_map (snapshot ref -> new textbook id) or nulled.
create or replace function public.shared_reading(p_reading jsonb, p_textbook_map jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_reading) = 'object' then jsonb_build_object(
    'textbook_id', coalesce(p_textbook_map -> (p_reading ->> 'textbook_id'), 'null'::jsonb),
    'chapters', coalesce((
      select jsonb_agg(case when jsonb_typeof(c) = 'string' then c else to_jsonb(c #>> '{}') end order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_reading -> 'chapters') = 'array'
                                     then p_reading -> 'chapters' else '[]'::jsonb end) with ordinality as t(c, n)
      where jsonb_typeof(c) in ('string', 'number')), '[]'::jsonb),
    'page_ranges', coalesce((
      select jsonb_agg(jsonb_build_object('start', r -> 'start', 'end', r -> 'end') order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_reading -> 'page_ranges') = 'array'
                                     then p_reading -> 'page_ranges' else '[]'::jsonb end) with ordinality as t(r, n)
      where jsonb_typeof(r -> 'start') = 'number' and jsonb_typeof(r -> 'end') = 'number'), '[]'::jsonb),
    'explicit_pages', case when jsonb_typeof(p_reading -> 'explicit_pages') = 'number'
                           then p_reading -> 'explicit_pages' else 'null'::jsonb end,
    'description', case when jsonb_typeof(p_reading -> 'description') = 'string'
                        then p_reading -> 'description' else 'null'::jsonb end
  ) end
$$;

-- textbooks.chapters (Chapter[]): entries need a number; title / pages are kept when well typed.
create or replace function public.shared_chapters(p_chapters jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'number', ch ->> 'number',
             'title', case when jsonb_typeof(ch -> 'title') = 'string' then ch -> 'title' else 'null'::jsonb end,
             'start_page', case when jsonb_typeof(ch -> 'start_page') = 'number' then ch -> 'start_page' else 'null'::jsonb end,
             'end_page', case when jsonb_typeof(ch -> 'end_page') = 'number' then ch -> 'end_page' else 'null'::jsonb end)
           order by n)
    from jsonb_array_elements(case when jsonb_typeof(p_chapters) = 'array' then p_chapters else '[]'::jsonb end)
         with ordinality as t(ch, n)
    where jsonb_typeof(ch -> 'number') in ('string', 'number')), '[]'::jsonb)
$$;

-- courses.grade_scale (GradeCutoff[]). Null (= keep the column default) when nothing usable is left.
create or replace function public.shared_grade_scale(p_scale jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object('letter', g -> 'letter', 'min', g -> 'min') order by n)
  from jsonb_array_elements(case when jsonb_typeof(p_scale) = 'array' then p_scale else '[]'::jsonb end)
       with ordinality as t(g, n)
  where jsonb_typeof(g -> 'letter') = 'string' and jsonb_typeof(g -> 'min') = 'number'
$$;

-- courses.policies (CoursePolicies).
create or replace function public.shared_policies(p_policies jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_policies) = 'object' then jsonb_strip_nulls(jsonb_build_object(
    'late_policy', case when jsonb_typeof(p_policies -> 'late_policy') = 'string' then p_policies -> 'late_policy' end,
    'unannounced_quizzes', case when jsonb_typeof(p_policies -> 'unannounced_quizzes') = 'boolean'
                                then p_policies -> 'unannounced_quizzes' end,
    'attendance_policy', case when jsonb_typeof(p_policies -> 'attendance_policy') = 'string'
                              then p_policies -> 'attendance_policy' end,
    'drop_policy', case when jsonb_typeof(p_policies -> 'drop_policy') = 'string' then p_policies -> 'drop_policy' end,
    'extra_credit', case when jsonb_typeof(p_policies -> 'extra_credit') = 'string' then p_policies -> 'extra_credit' end
  )) else '{}'::jsonb end
$$;

revoke execute on function public.shared_reading(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.shared_chapters(jsonb) from public, anon, authenticated;
revoke execute on function public.shared_grade_scale(jsonb) from public, anon, authenticated;
revoke execute on function public.shared_policies(jsonb) from public, anon, authenticated;

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
  v_scale jsonb;
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
  v_c := case when jsonb_typeof(v_snap -> 'course') = 'object' then v_snap -> 'course' else '{}'::jsonb end;

  insert into public.courses (
    user_id, term_id, code, title, section, instructor, credits, color, meeting_days,
    meeting_start, meeting_end, location, start_date, end_date, policies, shared_from_slug)
  values (
    v_uid, p_term_id, v_c ->> 'code', coalesce(v_c ->> 'title', 'Shared course'), v_c ->> 'section',
    v_c ->> 'instructor', (v_c ->> 'credits')::numeric, coalesce(v_c ->> 'color', '#5B5BD6'),
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(
                coalesce(v_c -> 'meeting_days', '[]'::jsonb)) as x), '{}'::smallint[]),
    (v_c ->> 'meeting_start')::time, (v_c ->> 'meeting_end')::time, v_c ->> 'location',
    (v_c ->> 'start_date')::date, (v_c ->> 'end_date')::date,
    public.shared_policies(v_c -> 'policies'), p_slug)
  returning id into v_course_id;

  -- Without a usable scale the course keeps the column default.
  v_scale := public.shared_grade_scale(v_c -> 'grade_scale');
  if v_scale is not null then
    update public.courses set grade_scale = v_scale where id = v_course_id;
  end if;

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
            public.shared_chapters(v_row -> 'chapters'))
    returning id into v_new;
    v_tb_map := v_tb_map || jsonb_build_object(v_row ->> 'ref', v_new);
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) loop
    insert into public.items (
      user_id, course_id, component_id, title, kind, description, assigned_date, due_date, due_time,
      weight_override, points_possible, estimated_minutes, reading, pages, is_major, source)
    values (
      v_uid, v_course_id, (v_comp_map ->> (v_row ->> 'component_ref'))::uuid,
      coalesce(v_row ->> 'title', 'Untitled'), coalesce(v_row ->> 'kind', 'other'), v_row ->> 'description',
      (v_row ->> 'assigned_date')::date, (v_row ->> 'due_date')::date, (v_row ->> 'due_time')::time,
      (v_row ->> 'weight_override')::numeric, (v_row ->> 'points_possible')::numeric,
      (v_row ->> 'estimated_minutes')::integer, public.shared_reading(v_row -> 'reading', v_tb_map),
      (v_row ->> 'pages')::integer, coalesce((v_row ->> 'is_major')::boolean, false), 'shared');
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
