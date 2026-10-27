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

await db.close();
if (process.exitCode) {
  console.error('\nDatabase checks FAILED');
} else {
  console.log('\nDatabase checks passed');
}
