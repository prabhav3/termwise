// ics-feed (auth: none, verify_jwt = false) — GET ?token=<profiles.ics_token> -> text/calendar.
// A read-only subscription for Apple Calendar, Google Calendar ("From URL"), or Outlook: every
// dated item of the student's non-archived courses. High-impact work gets a "★" prefix, the
// summary carries the course code, the description the weight and a termwise://item/<id> link.
// UIDs are the item ids, so clients update events in place. Unknown tokens get a 404.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import {
  addDays,
  courseLabel,
  effectiveWeights,
  type EntryCourse,
  type EntryItem,
  isHighImpact,
  ITEM_KIND_LABELS,
  itemDeepLink,
  itemDescription,
  itemSummary,
  localToUtcMs,
  resolveTimeZone,
  TIMED_EVENT_MINUTES,
  toHHMM,
  utcToLocal,
  type WeightedComponent,
} from '../_shared/calendar-model.ts';
import { buildIcs, type IcsDateTime, type IcsEventInput } from '../_shared/ics.ts';

type Db = SupabaseContext['supabaseAdmin'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;
const REFRESH_INTERVAL = 'PT3H';

interface ProfileRow {
  id: string;
  timezone: string;
  high_impact_threshold: number;
}

interface ItemRow extends EntryItem {
  course_id: string;
  updated_at: string;
}

class FeedLoadError extends Error {}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function fail(context: string, error: { code?: string }): never {
  throw new FeedLoadError(`ics-feed: ${context} failed (${error.code ?? 'unknown'})`);
}

async function loadItems(db: Db, userId: string, courseIds: string[]): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('items')
      .select('id, course_id, component_id, title, kind, due_date, due_time, weight_override, is_major, high_impact_override, status, updated_at')
      .eq('user_id', userId)
      .in('course_id', courseIds)
      .order('id')
      .range(from, from + PAGE - 1)
      .overrideTypes<ItemRow[], { merge: false }>();
    if (error) fail('item lookup', error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function buildFeed(db: Db, profile: ProfileRow): Promise<string> {
  const timeZone = resolveTimeZone(profile.timezone, 'America/New_York');
  const threshold = Number(profile.high_impact_threshold ?? 15);
  const { data: courseRows, error: courseError } = await db
    .from('courses')
    .select('id, code, title')
    .eq('user_id', profile.id)
    .eq('archived', false)
    .overrideTypes<EntryCourse[], { merge: false }>();
  if (courseError) fail('course lookup', courseError);
  const courses = new Map((courseRows ?? []).map((c) => [c.id, c]));
  const courseIds = [...courses.keys()];

  const events: IcsEventInput[] = [];
  if (courseIds.length > 0) {
    const [items, componentResult] = await Promise.all([
      loadItems(db, profile.id, courseIds),
      db
        .from('grading_components')
        .select('id, weight, expected_count, drop_lowest')
        .eq('user_id', profile.id)
        .in('course_id', courseIds)
        .overrideTypes<WeightedComponent[], { merge: false }>(),
    ]);
    if (componentResult.error) fail('component lookup', componentResult.error);
    const weights = effectiveWeights(items, componentResult.data ?? []);

    for (const item of items) {
      const course = courses.get(item.course_id);
      if (!item.due_date || !course) continue;
      const weight = weights.get(item.id) ?? null;
      const dueTime = toHHMM(item.due_time);
      let start: IcsDateTime;
      let end: IcsDateTime;
      if (dueTime) {
        // A short event that ends at the deadline, like calendar-sync pushes.
        const startLocal = utcToLocal(localToUtcMs(item.due_date, dueTime, timeZone) - TIMED_EVENT_MINUTES * 60_000, timeZone);
        start = { kind: 'zoned', date: startLocal.date, time: startLocal.time, tzid: timeZone };
        end = { kind: 'zoned', date: item.due_date, time: dueTime, tzid: timeZone };
      } else {
        start = { kind: 'date', date: item.due_date };
        end = { kind: 'date', date: addDays(item.due_date, 1) };
      }
      events.push({
        uid: `${item.id}@termwise.app`,
        summary: itemSummary(item, course, isHighImpact(item, weight, threshold)),
        description: itemDescription(item, course, weight),
        url: itemDeepLink(item.id),
        start,
        end,
        categories: [courseLabel(course), ITEM_KIND_LABELS[item.kind] ?? 'Deadline'],
        transparent: true,
        lastModified: item.updated_at,
      });
    }
  }
  events.sort((a, b) => (a.uid < b.uid ? -1 : 1));
  return buildIcs({
    prodId: '-//Termwise//Termwise Deadlines//EN',
    name: 'Termwise',
    description: 'Deadlines from Termwise. Edit them in the app.',
    timeZone,
    refreshInterval: REFRESH_INTERVAL,
    events,
  });
}

async function icsFeed(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Use GET.');
  const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  if (!UUID_RE.test(token)) return text(404, 'Calendar not found.');

  const db = ctx.supabaseAdmin;
  try {
    const { data: profile, error } = await db
      .from('profiles')
      .select('id, timezone, high_impact_threshold')
      .eq('ics_token', token)
      .maybeSingle()
      .overrideTypes<ProfileRow, { merge: false }>();
    if (error) fail('profile lookup', error);
    if (!profile) return text(404, 'Calendar not found.');

    const body = await buildFeed(db, profile);
    return new Response(req.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="termwise.ics"',
        'Cache-Control': 'private, max-age=900',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (err) {
    console.error(err instanceof FeedLoadError ? err.message : 'ics-feed: unexpected failure');
    return text(500, 'The calendar is temporarily unavailable.');
  }
}

export default { fetch: withSupabase({ auth: 'none' }, icsFeed) };
