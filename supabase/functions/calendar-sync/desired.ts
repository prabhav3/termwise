// What should be on the student's external calendar: every dated item of a non-archived course,
// plus planned study blocks for the next 30 days when a connection asks for them.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  blockEntry,
  type CalendarEntry,
  type EntryBlock,
  type EntryCourse,
  type EntryItem,
  effectiveWeights,
  isHighImpact,
  itemEntry,
  type PendingChange,
  resolveTimeZone,
  todayInZone,
  type WeightedComponent,
} from '../_shared/calendar-model.ts';

const PLAN_BLOCK_DAYS = 30;

export interface ItemRow extends EntryItem {
  course_id: string;
  external_change: (PendingChange & { provider?: string }) | null;
}

interface ComponentRow extends WeightedComponent {
  course_id: string;
}

export interface StudentCalendar {
  timeZone: string;
  itemEntries: CalendarEntry[];
  /** Built only when some connection syncs plan blocks. */
  blockEntries: CalendarEntry[];
  items: Map<string, ItemRow>;
}

function fail(context: string, error: { code?: string }): never {
  throw new Error(`calendar-sync: ${context} failed (${error.code ?? 'unknown'})`);
}

/** PostgREST caps a response at max_rows (1000), so items are read in pages. */
const PAGE = 1000;

async function loadItems(db: SupabaseClient, courseIds: string[]): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('items')
      .select('id, course_id, component_id, title, kind, due_date, due_time, weight_override, is_major, high_impact_override, status, external_change')
      .in('course_id', courseIds)
      .order('id')
      .range(from, from + PAGE - 1)
      .overrideTypes<ItemRow[], { merge: false }>();
    if (error) fail('item lookup', error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadStudentCalendar(db: SupabaseClient, userId: string, includeBlocks: boolean): Promise<StudentCalendar> {
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('timezone, high_impact_threshold')
    .eq('id', userId)
    .maybeSingle()
    .overrideTypes<{ timezone: string; high_impact_threshold: number }, { merge: false }>();
  if (profileError) fail('profile lookup', profileError);
  const timeZone = resolveTimeZone(profile?.timezone, 'America/New_York');
  const threshold = Number(profile?.high_impact_threshold ?? 15);

  const { data: courseRows, error: courseError } = await db
    .from('courses')
    .select('id, code, title')
    .eq('archived', false)
    .overrideTypes<EntryCourse[], { merge: false }>();
  if (courseError) fail('course lookup', courseError);
  const courses = new Map((courseRows ?? []).map((c) => [c.id, c]));
  const courseIds = [...courses.keys()];
  if (courseIds.length === 0) return { timeZone, itemEntries: [], blockEntries: [], items: new Map() };

  const [items, componentResult] = await Promise.all([
    loadItems(db, courseIds),
    db
      .from('grading_components')
      .select('id, course_id, weight, expected_count, drop_lowest')
      .in('course_id', courseIds)
      .overrideTypes<ComponentRow[], { merge: false }>(),
  ]);
  if (componentResult.error) fail('component lookup', componentResult.error);

  // Weights need every item of a component, dated or not.
  const weights = effectiveWeights(items, componentResult.data ?? []);
  const itemEntries: CalendarEntry[] = [];
  for (const item of items) {
    if (!item.due_date) continue;
    const course = courses.get(item.course_id);
    if (!course) continue;
    const weight = weights.get(item.id) ?? null;
    itemEntries.push(itemEntry({ ...item, due_date: item.due_date }, course, weight, isHighImpact(item, weight, threshold), timeZone));
  }

  const blockEntries: CalendarEntry[] = [];
  if (includeBlocks) {
    const today = todayInZone(timeZone);
    const { data: blocks, error: blockError } = await db
      .from('plan_blocks')
      .select('key, item_id, course_id, date, minutes, kind, label')
      .eq('status', 'planned')
      .gte('date', today)
      .lt('date', addDays(today, PLAN_BLOCK_DAYS))
      .in('course_id', courseIds)
      .order('date')
      .overrideTypes<Array<EntryBlock & { course_id: string }>, { merge: false }>();
    if (blockError) fail('plan lookup', blockError);
    for (const block of blocks ?? []) {
      const course = courses.get(block.course_id);
      if (course) blockEntries.push(blockEntry(block, course, timeZone));
    }
  }
  return { timeZone, itemEntries, blockEntries, items: new Map(items.map((i) => [i.id, i])) };
}
