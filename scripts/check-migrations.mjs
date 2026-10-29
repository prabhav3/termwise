#!/usr/bin/env node
// Applies supabase/migrations/*.sql to an in-memory Postgres (PGlite) with minimal stubs of the
// Supabase-managed schemas (auth, storage, realtime publication), then runs RLS smoke tests.
// No Docker needed:  npm run check:db
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid
);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create publication supabase_realtime;
`;

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

async function asUser(db, uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function expectError(promise, label) {
  try {
    await promise;
    fail(`${label}: expected an error but the statement succeeded`);
  } catch {
    ok(label);
  }
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(STUBS);

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = readFileSync(join(migrationsDir, f), 'utf8');
  try {
    await db.exec(sql);
    ok(`applied ${f}`);
  } catch (e) {
    fail(`migration ${f} failed: ${e.message}`);
    process.exit(1);
  }
}

// --- smoke tests -----------------------------------------------------------
await db.exec(`insert into auth.users (id, email) values ('${U1}', 'ana@example.edu'), ('${U2}', 'ben@example.edu');`);
const profiles = await db.query('select id, display_name from public.profiles order by display_name');
profiles.rows.length === 2 ? ok('profiles created by auth trigger') : fail('profile trigger did not fire');

const courseId = await asUser(db, U1, async () => {
  const term = await db.query(`insert into public.terms (name) values ('Fall 2026') returning id`);
  const course = await db.query(
    `insert into public.courses (term_id, title, code) values ($1, 'Intro Psychology', 'PSY 101') returning id`,
    [term.rows[0].id],
  );
  const cid = course.rows[0].id;
  const comp = await db.query(
    `insert into public.grading_components (course_id, name, weight, drop_lowest) values ($1, 'Quizzes', 15, 1) returning id`,
    [cid],
  );
  await db.query(
    `insert into public.items (course_id, component_id, title, kind, due_date) values ($1, $2, 'Quiz 1', 'quiz', '2026-09-10')`,
    [cid, comp.rows[0].id],
  );
  await db.query(
    `insert into public.textbooks (course_id, title, chapters) values ($1, 'Psychology 13e', '[{"number":"4","title":"Memory","start_page":101,"end_page":134}]')`,
    [cid],
  );
  return cid;
});
ok('owner can create term, course, component, item, textbook');

await asUser(db, U2, async () => {
  const r = await db.query('select count(*)::int as n from public.courses');
  r.rows[0].n === 0 ? ok('RLS hides other users’ courses') : fail('RLS leak: U2 sees U1 courses');
  await expectError(
    db.query(`insert into public.items (course_id, title) values ($1, 'sneaky')`, [courseId]),
    'RLS blocks inserting items into another user’s course',
  );
  await expectError(db.query('select * from public.calendar_secrets'), 'secrets table not readable by authenticated');
});

const share = await asUser(db, U1, () => db.query(`select slug from public.create_share_link($1)`, [courseId]));
const slug = share.rows[0].slug;
slug ? ok(`create_share_link -> ${slug}`) : fail('create_share_link returned no slug');

await db.exec(`set role anon;`);
const pub = await db.query(`select public.get_shared_timeline($1) as t`, [slug]);
await db.exec(`reset role;`);
pub.rows[0].t?.snapshot?.items?.length === 1 ? ok('anon can read share snapshot') : fail('anon cannot read share snapshot');
JSON.stringify(pub.rows[0].t).includes('"score"') ? fail('share snapshot leaks scores') : ok('share snapshot has no scores');

const imported = await asUser(db, U2, async () => {
  const r = await db.query(`select public.import_shared_timeline($1) as id`, [slug]);
  const items = await db.query(`select title, source, component_id is not null as linked from public.items`);
  return { id: r.rows[0].id, items: items.rows };
});
imported.items.length === 1 && imported.items[0].source === 'shared' && imported.items[0].linked
  ? ok('import_shared_timeline clones items with component links into the importer’s account')
  : fail(`import_shared_timeline produced ${JSON.stringify(imported.items)}`);

await asUser(db, U1, async () => {
  await db.query(`insert into storage.objects (bucket_id, name) values ('syllabi', '${U1}/abc/0.pdf')`);
  ok('storage policy allows own folder');
  await expectError(
    db.query(`insert into storage.objects (bucket_id, name) values ('syllabi', '${U2}/abc/0.pdf')`),
    'storage policy blocks other users’ folders',
  );
});

// --- 20261028000000_security_fixes.sql ---------------------------------------------
async function anonSharedTimeline(s) {
  await db.exec(`set role anon;`);
  try {
    return (await db.query(`select public.get_shared_timeline($1) as t`, [s])).rows[0].t;
  } finally {
    await db.exec(`reset role;`);
  }
}

await asUser(db, U2, async () => {
  await expectError(db.query('select * from public.calendar_oauth_pending'), 'calendar_oauth_pending not readable by authenticated');
  await expectError(
    db.query(
      `insert into public.calendar_oauth_pending (nonce, user_id, provider, code_verifier, expires_at)
       values ('n', '${U2}', 'google', 'v', now() + interval '5 minutes')`,
    ),
    'calendar_oauth_pending not writable by authenticated',
  );
  await expectError(db.query('select * from public.apple_secrets'), 'apple_secrets not readable by authenticated');
  await expectError(
    db.query(`insert into public.apple_secrets (user_id, refresh_token_enc) values ('${U2}', 'x')`),
    'apple_secrets not writable by authenticated',
  );
});

// Share rows: owners may only flip `revoked`; course_id / slug / snapshot / import_count stay server-managed.
const unsharedCourseId = await asUser(db, U1, async () =>
  (await db.query(`insert into public.courses (title) values ('Not shared yet') returning id`)).rows[0].id,
);
const benShare = await asUser(db, U2, async () => {
  const c = await db.query(`insert into public.courses (title) values ('Ben course') returning id`);
  const s = await db.query(`select id, slug from public.create_share_link($1)`, [c.rows[0].id]);
  return s.rows[0];
});
await asUser(db, U2, async () => {
  await expectError(
    db.query(`update public.shared_timelines set course_id = $1 where id = $2`, [unsharedCourseId, benShare.id]),
    'owners cannot repoint their share row at another user’s course',
  );
  await expectError(
    db.query(`update public.shared_timelines set snapshot = '{}'::jsonb where id = $1`, [benShare.id]),
    'owners cannot rewrite a share snapshot directly',
  );
  await expectError(db.query(`update public.shared_timelines set slug = 'chosen' where id = $1`, [benShare.id]), 'owners cannot pick a slug');
  await expectError(
    db.query(`update public.shared_timelines set import_count = 999 where id = $1`, [benShare.id]),
    'owners cannot edit import_count',
  );
});
const victimShare = await asUser(db, U1, () =>
  db.query(`select owner_id, slug from public.create_share_link($1)`, [unsharedCourseId]),
);
victimShare.rows[0].owner_id === U1 && victimShare.rows[0].slug !== benShare.slug
  ? ok('a course owner’s new share link is their own row')
  : fail(`victim share returned ${JSON.stringify(victimShare.rows[0])}`);
const reshared = await asUser(db, U1, () => db.query(`select slug, owner_id from public.create_share_link($1)`, [courseId]));
reshared.rows[0].slug === slug && reshared.rows[0].owner_id === U1
  ? ok('sharing again while shared keeps the same slug and owner')
  : fail(`re-share without revoke returned ${JSON.stringify(reshared.rows[0])}`);

// A legacy row whose owner doesn't own the course is never updated by create_share_link.
await db.query(`update public.shared_timelines set owner_id = $1 where course_id = $2`, [U2, courseId]);
await asUser(db, U1, () =>
  expectError(db.query(`select public.create_share_link($1)`, [courseId]), 'create_share_link refuses a share row owned by someone else'),
);
await db.query(`update public.shared_timelines set owner_id = $1 where course_id = $2`, [U1, courseId]);

// Stop sharing, then share again: the old slug stays dead.
const stopped = await asUser(db, U1, () =>
  db.query(`update public.shared_timelines set revoked = true where slug = $1 returning id`, [slug]),
);
stopped.rows.length === 1 ? ok('owner can stop sharing (update revoked)') : fail('owner could not revoke their share');
(await anonSharedTimeline(slug)) === null ? ok('revoked slug no longer resolves') : fail('revoked slug still resolves');
const fresh = await asUser(db, U1, () => db.query(`select slug from public.create_share_link($1)`, [courseId]));
const freshSlug = fresh.rows[0].slug;
freshSlug && freshSlug !== slug && /^[0-9a-f]{12}$/.test(freshSlug)
  ? ok('sharing again after revoking issues a new slug')
  : fail(`re-share after revoke returned slug ${freshSlug} (old ${slug})`);
(await anonSharedTimeline(slug)) === null
  ? ok('old slug stays dead after sharing again')
  : fail('old revoked slug came back after sharing again');
(await anonSharedTimeline(freshSlug))?.snapshot ? ok('new slug resolves') : fail('new slug does not resolve');

// import_shared_timeline rebuilds JSON from type-checked keys.
const poisoned = await asUser(db, U1, async () => {
  const c = await db.query(
    `insert into public.courses (title, grade_scale, policies) values ('Poisoned', '"oops"', '[1]') returning id`,
  );
  const cid = c.rows[0].id;
  const tb = await db.query(
    `insert into public.textbooks (course_id, title, chapters) values
       ($1, 'Good book', '[{"number":"4","title":"Memory","start_page":101,"end_page":"134"},{"title":"no number"},3,{"number":5}]'),
       ($1, 'Bad book', '{"x":1}')
     returning id, title`,
    [cid],
  );
  const goodBook = tb.rows.find((r) => r.title === 'Good book').id;
  await db.query(
    `insert into public.items (course_id, title, kind, reading) values
       ($1, 'Empty reading', 'reading', '{}'),
       ($1, 'Mixed reading', 'reading', $2),
       ($1, 'String reading', 'reading', '"str"')`,
    [
      cid,
      JSON.stringify({
        textbook_id: goodBook,
        chapters: ['4', 5, { x: 1 }, null],
        page_ranges: [{ start: 1, end: 10 }, 'bad', { start: '1', end: 2 }, null],
        explicit_pages: '12',
        description: 7,
      }),
    ],
  );
  const s = await db.query(`select slug from public.create_share_link($1)`, [cid]);
  return s.rows[0].slug;
});
const cleaned = await asUser(db, U2, async () => {
  const r = await db.query(`select public.import_shared_timeline($1) as id`, [poisoned]);
  const cid = r.rows[0].id;
  const course = await db.query(`select grade_scale, policies from public.courses where id = $1`, [cid]);
  const books = await db.query(`select id, title, chapters from public.textbooks where course_id = $1 order by title`, [cid]);
  const items = await db.query(`select title, reading from public.items where course_id = $1 order by title`, [cid]);
  return { course: course.rows[0], books: books.rows, items: Object.fromEntries(items.rows.map((i) => [i.title, i.reading])) };
});
const goodBookCopy = cleaned.books.find((b) => b.title === 'Good book');
const badBookCopy = cleaned.books.find((b) => b.title === 'Bad book');
JSON.stringify(cleaned.items['Empty reading']) ===
JSON.stringify({ chapters: [], description: null, page_ranges: [], textbook_id: null, explicit_pages: null })
  ? ok('import gives a malformed reading every field with the right type')
  : fail(`imported empty reading: ${JSON.stringify(cleaned.items['Empty reading'])}`);
const mixed = cleaned.items['Mixed reading'];
mixed?.textbook_id === goodBookCopy?.id &&
JSON.stringify(mixed.chapters) === '["4","5"]' &&
JSON.stringify(mixed.page_ranges) === '[{"end":10,"start":1}]' &&
mixed.explicit_pages === null &&
mixed.description === null
  ? ok('import keeps well-typed reading fields, remaps the textbook, and drops the rest')
  : fail(`imported mixed reading: ${JSON.stringify(mixed)}`);
cleaned.items['String reading'] === null ? ok('import drops a non-object reading') : fail('non-object reading was imported');
JSON.stringify(badBookCopy?.chapters) === '[]' &&
JSON.stringify(goodBookCopy?.chapters) ===
  '[{"title":"Memory","number":"4","end_page":null,"start_page":101},{"title":null,"number":"5","end_page":null,"start_page":null}]'
  ? ok('import keeps only well-formed textbook chapters')
  : fail(`imported chapters: ${JSON.stringify(cleaned.books.map((b) => b.chapters))}`);
Array.isArray(cleaned.course.grade_scale) && cleaned.course.grade_scale.length === 12 && cleaned.course.grade_scale[0].letter === 'A'
  ? ok('import falls back to the default grade scale for a malformed one')
  : fail(`imported grade_scale: ${JSON.stringify(cleaned.course.grade_scale)}`);
JSON.stringify(cleaned.course.policies) === '{}' ? ok('import replaces non-object policies with {}') : fail(`imported policies: ${JSON.stringify(cleaned.course.policies)}`);

// A snapshot edited outside create_share_link (e.g. before the column lock) is sanitized too.
await db.query(
  `update public.shared_timelines
      set snapshot = jsonb_set(jsonb_set(snapshot, '{course,grade_scale}', $2::jsonb), '{course,policies}', $3::jsonb)
    where slug = $1`,
  [
    poisoned,
    JSON.stringify([{ letter: 'A', min: 'x' }, { letter: 'B', min: 80 }, 'C']),
    JSON.stringify({ late_policy: 5, unannounced_quizzes: true, drop_policy: 'Lowest quiz', extra: 'x' }),
  ],
);
const tampered = await asUser(db, U2, async () => {
  const r = await db.query(`select public.import_shared_timeline($1) as id`, [poisoned]);
  return (await db.query(`select grade_scale, policies from public.courses where id = $1`, [r.rows[0].id])).rows[0];
});
JSON.stringify(tampered.grade_scale) === '[{"min":80,"letter":"B"}]' &&
JSON.stringify(tampered.policies) === '{"drop_policy":"Lowest quiz","unannounced_quizzes":true}'
  ? ok('import keeps only well-typed grade-scale entries and known policy keys')
  : fail(`imported tampered course: ${JSON.stringify(tampered)}`);

// --- 20261028000300_calendar_columns.sql ------------------------------------------
// Google / Outlook container ids are written only by the service role (calendar-sync,
// calendar-oauth-finish); Apple rows keep them app-writable for the on-device sync.
async function asServiceRole(fn) {
  await db.exec(`set role service_role;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

async function expectGuarded(promise, label) {
  try {
    await promise;
    fail(`${label}: expected the container guard to refuse it`);
  } catch (e) {
    /managed by Termwise/.test(e.message) ? ok(label) : fail(`${label}: failed for another reason (${e.message})`);
  }
}

const appleConn = await asUser(db, U1, async () => {
  const r = await db.query(
    `insert into public.calendar_connections (provider, device_id, external_calendar_id) values ('apple', 'device-1', 'ek-cal') returning id`,
  );
  await db.query(`update public.calendar_connections set task_list_id = 'ek-list', external_calendar_id = 'ek-cal-2' where id = $1`, [
    r.rows[0].id,
  ]);
  return r.rows[0].id;
});
ok('students can still set Apple calendar / list ids');

await asUser(db, U1, () =>
  expectGuarded(
    db.query(`insert into public.calendar_connections (provider, external_calendar_id) values ('google', 'primary')`),
    'students cannot create a Google connection that points at a calendar of their choosing',
  ),
);
const googleConn = await asServiceRole(async () => {
  const r = await db.query(
    `insert into public.calendar_connections (user_id, provider, account_email) values ($1, 'google', 'ana@example.edu') returning id`,
    [U1],
  );
  await db.query(`update public.calendar_connections set external_calendar_id = 'termwise-cal', task_list_id = 'termwise-list' where id = $1`, [
    r.rows[0].id,
  ]);
  return r.rows[0].id;
});
ok('the service role records the Termwise calendar and task list');

await asUser(db, U1, async () => {
  await expectGuarded(
    db.query(`update public.calendar_connections set external_calendar_id = 'primary' where id = $1`, [googleConn]),
    'students cannot repoint the Google calendar id',
  );
  await expectGuarded(
    db.query(`update public.calendar_connections set task_list_id = '@default' where id = $1`, [googleConn]),
    'students cannot repoint the Google task list id',
  );
  await expectGuarded(
    db.query(`update public.calendar_connections set external_calendar_id = null where id = $1`, [googleConn]),
    'students cannot clear the Google calendar id',
  );
  const r = await db.query(
    `update public.calendar_connections set delivery = 'task', sync_plan_blocks = true where id = $1
     returning delivery, sync_plan_blocks, external_calendar_id, task_list_id`,
    [googleConn],
  );
  const row = r.rows[0];
  row?.delivery === 'task' && row.sync_plan_blocks === true && row.external_calendar_id === 'termwise-cal' && row.task_list_id === 'termwise-list'
    ? ok('students can still change delivery and plan-block sync on a Google connection')
    : fail(`delivery update returned ${JSON.stringify(row)}`);
  await expectGuarded(
    db.query(`update public.calendar_connections set provider = 'microsoft', device_id = '' where id = $1`, [appleConn]),
    'students cannot turn an Apple row with ids into a cloud connection',
  );
  const ms = await db.query(`insert into public.calendar_connections (provider) values ('microsoft') returning external_calendar_id`);
  ms.rows[0]?.external_calendar_id === null
    ? ok('students can still create a cloud row without container ids')
    : fail(`microsoft insert returned ${JSON.stringify(ms.rows[0])}`);
});

// --- 20261028000400_parse_runs: the paid-parse log is service-role only ---------------------
await db.query(`insert into public.parse_runs (user_id) values ($1)`, [U1]);
await asUser(db, U1, async () => {
  await expectError(db.query('select * from public.parse_runs'), 'students cannot read the parse-run log');
  await expectError(db.query('delete from public.parse_runs'), 'students cannot erase their parse runs');
  await expectError(
    db.query(`insert into public.parse_runs (user_id) values ($1)`, [U1]),
    'students cannot write parse runs themselves',
  );
});

// --- 20261028000500_plan_block_guard: a stale replan can't revive a finished block ----------
await asUser(db, U1, async () => {
  const item = await db.query(`select id, course_id from public.items where course_id = $1 limit 1`, [courseId]);
  const { id: itemId, course_id } = item.rows[0];
  await db.query(
    `insert into public.plan_blocks (item_id, course_id, key, date, minutes, kind, label, status)
     values ($1, $2, 'guard:0', '2026-11-02', 30, 'work', 'Work', 'done')`,
    [itemId, course_id],
  );
  const r = await db.query(
    `insert into public.plan_blocks (item_id, course_id, key, date, minutes, kind, label, status)
     values ($1, $2, 'guard:0', '2026-11-03', 45, 'work', 'Work', 'planned')
     on conflict (user_id, key) do update set status = excluded.status, date = excluded.date, minutes = excluded.minutes
     returning status, date::text`,
    [itemId, course_id],
  );
  r.rows[0]?.status === 'done' && r.rows[0].date === '2026-11-02'
    ? ok('a stale planned upsert leaves a done block untouched')
    : fail(`guarded upsert returned ${JSON.stringify(r.rows[0])}`);
});

await db.close();
if (process.exitCode) {
  console.error('\nDatabase checks FAILED');
} else {
  console.log('\nDatabase checks passed');
}
