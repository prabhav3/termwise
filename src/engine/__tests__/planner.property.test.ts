// Seeded property test: ~200 random semesters through buildPlan / rescheduleAfterMiss, checking
// the planner's invariants. Failures print the seed so a case can be replayed on its own.
import { describe, expect, it } from 'vitest';
import { addDays, buildPlan, eachDay, rescheduleAfterMiss } from '../index';
import { studyDayChecker } from '../load';
import type {
  AnnotatedItem,
  EngineBlock,
  EngineComponent,
  EngineCourse,
  EngineItem,
  EngineReading,
  EngineTextbook,
  ISODate,
  ItemKind,
  ItemStatus,
  PlanInput,
  PlanResult,
} from '../types';

const SEMESTERS = 200;

/** Tiny seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next: () => number;
  int: (min: number, max: number) => number;
  chance: (p: number) => boolean;
  pick: <T>(values: readonly T[]) => T;
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
  shuffle: <T>(values: readonly T[]) => T[];
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (values) => values[int(0, values.length - 1)],
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, w] of entries) {
        roll -= w;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    shuffle: (values) => {
      const out = [...values];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

const KINDS: readonly (readonly [ItemKind, number])[] = [
  ['reading', 30],
  ['homework', 18],
  ['quiz', 10],
  ['exam', 6],
  ['paper', 5],
  ['project', 3],
  ['presentation', 3],
  ['lab', 8],
  ['discussion', 10],
  ['other', 4],
];

const STATUSES: readonly (readonly [ItemStatus, number])[] = [
  ['todo', 75],
  ['in_progress', 10],
  ['done', 10],
  ['missed', 5],
];

function randomReading(rng: Rng, textbook: EngineTextbook | null): EngineReading {
  const reading: EngineReading = { textbook_id: null, chapters: [], page_ranges: [], explicit_pages: null, description: null };
  const mode = rng.int(0, 3);
  if (mode === 0) {
    const start = rng.int(1, 400);
    reading.page_ranges = [{ start, end: start + rng.int(0, 40) }];
    if (rng.chance(0.3)) {
      const second = start + rng.int(45, 80);
      reading.page_ranges.push({ start: second, end: second + rng.int(0, 15) });
    }
  } else if (mode === 1 && textbook) {
    reading.textbook_id = rng.chance(0.7) ? textbook.id : null;
    const first = rng.int(1, 10);
    reading.chapters = Array.from({ length: rng.int(1, 2) }, (_, i) => String(first + i));
  } else if (mode === 2) {
    reading.explicit_pages = rng.int(3, 70);
  } else {
    reading.chapters = [String(rng.int(1, 12))];
  }
  return reading;
}

function randomTextbook(rng: Rng, courseId: string): EngineTextbook {
  let page = rng.int(1, 30);
  const chapters = Array.from({ length: 12 }, (_, i) => {
    const size = rng.int(12, 40);
    const mapped = rng.chance(0.8);
    const chapter = {
      number: String(i + 1),
      title: `Chapter ${i + 1}`,
      start_page: mapped ? page : null,
      end_page: mapped ? page + size - 1 : null,
    };
    page += size;
    return chapter;
  });
  return { id: `tb-${courseId}`, course_id: courseId, title: 'Textbook', chapters };
}

function randomSemester(seed: number): PlanInput {
  const rng = makeRng(seed);
  const termStart: ISODate = '2026-08-31';
  const today = addDays(termStart, rng.int(0, 100));
  const studyDays = [0, 1, 2, 3, 4, 5, 6].filter(() => rng.chance(0.75));
  if (studyDays.length === 0) studyDays.push(rng.int(0, 6));
  const blackout = Array.from({ length: rng.int(0, 3) }, () => addDays(today, rng.int(0, 30)));

  const courses: EngineCourse[] = [];
  const components: EngineComponent[] = [];
  const textbooks: EngineTextbook[] = [];
  const items: EngineItem[] = [];
  const courseCount = rng.int(3, 6);
  for (let c = 0; c < courseCount; c++) {
    const courseId = `c${c}`;
    courses.push({
      id: courseId,
      title: `Course ${c}`,
      code: rng.chance(0.85) ? `SUBJ ${100 + c * 10 + rng.int(0, 9)}` : null,
      color: '#000000',
      credits: rng.chance(0.85) ? rng.int(1, 5) : null,
      meeting_days: [1, 2, 3, 4, 5].filter(() => rng.chance(0.4)),
      start_date: termStart,
      end_date: addDays(termStart, 110),
      target_percent: null,
      grade_scale: [],
      policies: { unannounced_quizzes: rng.chance(0.25) },
      archived: rng.chance(0.05),
    });
    const textbook = rng.chance(0.7) ? randomTextbook(rng, courseId) : null;
    if (textbook) textbooks.push(textbook);

    const courseComponents: EngineComponent[] = Array.from({ length: rng.int(0, 4) }, (_, k) => ({
      id: `${courseId}-g${k}`,
      course_id: courseId,
      name: `Group ${k}`,
      weight: rng.int(5, 40),
      expected_count: rng.chance(0.5) ? rng.int(1, 12) : null,
      drop_lowest: rng.chance(0.2) ? rng.int(1, 2) : 0,
    }));
    components.push(...courseComponents);

    const itemCount = rng.int(5, 40);
    for (let n = 0; n < itemCount; n++) {
      const kind = rng.weighted(KINDS);
      const due = rng.chance(0.05) ? null : addDays(termStart, rng.int(0, 120));
      const assigned = due !== null && rng.chance(0.3) ? addDays(due, -rng.int(0, 25)) : null;
      items.push({
        id: `${courseId}-i${String(n).padStart(2, '0')}`,
        course_id: courseId,
        component_id: courseComponents.length > 0 && rng.chance(0.7) ? rng.pick(courseComponents).id : null,
        title: `${kind} ${n}`,
        kind,
        assigned_date: assigned,
        due_date: due,
        due_time: null,
        weight_override: rng.chance(0.15) ? rng.int(0, 35) : null,
        points_possible: null,
        score: null,
        estimated_minutes: rng.chance(0.2) ? rng.int(10, 400) : null,
        reading: kind === 'reading' || rng.chance(0.05) ? randomReading(rng, textbook) : null,
        pages: kind === 'reading' && rng.chance(0.1) ? rng.int(1, 60) : null,
        status: rng.weighted(STATUSES),
        high_impact_override: rng.chance(0.1) ? rng.chance(0.5) : null,
        is_major: rng.chance(0.08),
      });
    }
  }

  const base: PlanInput = {
    courses,
    components,
    items,
    textbooks,
    termEvents: [],
    existingBlocks: [],
    settings: {
      today,
      study_days: studyDays,
      daily_capacity_minutes: rng.int(60, 300),
      reading_pages_per_hour: rng.int(10, 40),
      default_pages_per_chapter: rng.int(10, 35),
      high_impact_threshold: rng.pick([10, 15, 20]),
      blackout_dates: blackout,
    },
  };

  // History: an earlier plan, partly done / missed / skipped / left as is, plus some manual blocks.
  const previousToday = addDays(today, -rng.int(1, 14));
  const previous = buildPlan({ ...base, settings: { ...base.settings, today: previousToday } });
  const history: EngineBlock[] = previous.blocks.map((block) => {
    const status =
      block.date < today
        ? rng.weighted<EngineBlock['status']>([['done', 50], ['missed', 15], ['skipped', 5], ['planned', 30]])
        : rng.weighted<EngineBlock['status']>([['planned', 85], ['done', 10], ['skipped', 5]]);
    return { ...block, id: `db-${block.key}`, status };
  });
  const openItems = items.filter((i) => i.due_date !== null);
  for (let m = 0, count = rng.int(0, 3); m < count && openItems.length > 0; m++) {
    const item = rng.pick(openItems);
    history.push({
      id: `db-manual-${m}`,
      key: `manual-${seed}-${m}`,
      item_id: item.id,
      course_id: item.course_id,
      date: addDays(today, rng.int(-5, 10)),
      minutes: rng.int(15, 90),
      kind: 'work',
      label: 'My own session',
      page_start: null,
      page_end: null,
      status: rng.chance(0.5) ? 'planned' : 'done',
      sort_order: 0,
      generated_by: 'manual',
    });
  }
  return { ...base, existingBlocks: rng.shuffle(history) };
}

// ---- invariant helpers ---------------------------------------------------------------------

const isFresh = (b: EngineBlock) => b.status === 'planned' && b.generated_by !== 'manual';
const isHistoryLoad = (b: EngineBlock) => b.status === 'done' || (b.status === 'planned' && b.generated_by === 'manual');

function loads(blocks: EngineBlock[], predicate: (b: EngineBlock) => boolean): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  for (const b of blocks) if (predicate(b)) out.set(b.date, (out.get(b.date) ?? 0) + b.minutes);
  return out;
}

function bufferLead(item: AnnotatedItem): number {
  const w = item.impact.weight;
  if ((w !== null && w >= 20) || item.impact.isHighImpact) return 21;
  return w !== null && w >= 10 ? 14 : 7;
}

function expectPlanInvariants(input: PlanInput, result: PlanResult, label: string): void {
  const { settings } = input;
  const today = settings.today;
  const cap = settings.daily_capacity_minutes;
  const overCap = Math.floor(cap * 1.25);
  const isStudyDay = studyDayChecker(settings);
  const items = new Map(result.annotated.map((i) => [i.id, i]));
  const archived = new Set(input.courses.filter((c) => c.archived).map((c) => c.id));

  // Keys are unique.
  const keys = result.blocks.map((b) => b.key);
  expect(new Set(keys).size, `${label}: duplicate keys`).toBe(keys.length);

  // History is kept as-is; past engine-planned blocks come back as missed.
  const byKey = new Map(result.blocks.map((b) => [b.key, b]));
  for (const block of input.existingBlocks) {
    const out = byKey.get(block.key);
    const engineMade = block.generated_by !== 'manual';
    if (engineMade && block.status === 'planned') {
      if (block.date < today) expect(out, `${label}: carry-over ${block.key}`).toEqual({ ...block, status: 'missed' });
    } else {
      expect(out, `${label}: history ${block.key}`).toEqual(block);
    }
  }

  // Blocked dates per item: missed/skipped history on or after today.
  const blocked = new Map<string, Set<ISODate>>();
  for (const b of result.blocks) {
    if ((b.status === 'missed' || b.status === 'skipped') && b.date >= today) {
      const set = blocked.get(b.item_id) ?? new Set<ISODate>();
      set.add(b.date);
      blocked.set(b.item_id, set);
    }
  }

  // Fresh blocks: dated today … due, papers/projects by due − 2 when the window allows.
  for (const block of result.blocks.filter(isFresh)) {
    const item = items.get(block.item_id);
    expect(item, `${label}: block for unknown item ${block.key}`).toBeDefined();
    if (!item || item.due_date === null) continue;
    expect(block.date >= today, `${label}: ${block.key} on ${block.date} is before today ${today}`).toBe(true);
    expect(block.date <= item.due_date, `${label}: ${block.key} on ${block.date} is after due ${item.due_date}`).toBe(true);
    expect(Number.isInteger(block.minutes) && block.minutes > 0, `${label}: ${block.key} minutes ${block.minutes}`).toBe(true);
    expect(blocked.get(item.id)?.has(block.date) ?? false, `${label}: ${block.key} on a missed/skipped date`).toBe(false);
    if (block.page_start !== null || block.page_end !== null) {
      expect(block.page_start !== null && block.page_end !== null && block.page_start <= block.page_end).toBe(true);
    }
    if ((item.kind === 'paper' || item.kind === 'project') && block.date > addDays(item.due_date, -2)) {
      const start = [today, item.assigned_date ?? today, addDays(item.due_date, -bufferLead(item))].sort().reverse()[0];
      const roomy = eachDay(start, addDays(item.due_date, -2)).some((d) => isStudyDay(d) && !blocked.get(item.id)?.has(d));
      expect(roomy, `${label}: ${block.key} on ${block.date} breaks the due − 2 buffer (due ${item.due_date})`).toBe(false);
    }
  }

  // No day above 125% of capacity (beyond what history alone already put there).
  const history = loads(result.blocks, isHistoryLoad);
  const total = loads(result.blocks, (b) => b.date >= today && (isHistoryLoad(b) || isFresh(b)));
  for (const [date, minutes] of total) {
    const ceiling = Math.max(overCap, history.get(date) ?? 0);
    expect(minutes, `${label}: ${date} holds ${minutes} min (cap ${cap})`).toBeLessThanOrEqual(ceiling);
  }

  // Planned + done covers each plannable item's effort unless an overflow warning names it.
  const warned = new Set(result.overflow.map((w) => w.item_id));
  for (const item of result.annotated) {
    if (item.status === 'done' || item.status === 'missed' || item.due_date === null || item.due_date < today) continue;
    if (archived.has(item.course_id) || warned.has(item.id)) continue;
    const own = result.blocks.filter((b) => b.item_id === item.id);
    const done = own.filter((b) => b.status === 'done');
    const planned = own.filter((b) => b.status === 'planned' && b.date >= today);
    const covered = [...done, ...planned].reduce((sum, b) => sum + b.minutes, 0);
    if (covered >= item.effortMinutes) continue;
    // A reading whose pages are all read (done/manual blocks) needs no more time.
    const pagesDone = [...done, ...planned.filter((b) => b.generated_by === 'manual')].reduce(
      (sum, b) => sum + (b.page_start !== null && b.page_end !== null ? b.page_end - b.page_start + 1 : 0),
      0,
    );
    const finishedReading = item.resolvedPages !== null && pagesDone >= item.resolvedPages;
    expect(finishedReading, `${label}: ${item.id} (${item.kind}) has ${covered}/${item.effortMinutes} min and no warning`).toBe(true);
  }

  // Warnings are about real shortfalls.
  for (const warning of result.overflow) {
    expect(warning.unplacedMinutes).toBeGreaterThan(0);
    expect(warning.message.length).toBeGreaterThan(0);
    expect(warning.suggestion.length).toBeGreaterThan(0);
  }

  // Day loads cover today … latest due (≤ 180 days), one entry per day.
  expect(result.days[0]?.date).toBe(today);
  expect(result.days.length).toBeLessThanOrEqual(180);
  for (let i = 1; i < result.days.length; i++) expect(result.days[i].date).toBe(addDays(result.days[i - 1].date, 1));
}

describe('buildPlan properties over random semesters', () => {
  it(`holds every invariant for ${SEMESTERS} seeded semesters`, () => {
    let blocksSeen = 0;
    let overflowSeen = 0;
    let rescheduled = 0;
    for (let seed = 1; seed <= SEMESTERS; seed++) {
      const label = `seed ${seed}`;
      const input = randomSemester(seed);
      const result = buildPlan(input);
      expectPlanInvariants(input, result, label);
      blocksSeen += result.blocks.filter(isFresh).length;
      overflowSeen += result.overflow.length;

      // Deterministic: identical input ⇒ identical output, regardless of input order.
      expect(buildPlan(structuredClone(input)), `${label}: not deterministic`).toEqual(result);
      const rng = makeRng(seed * 7919);
      const shuffled = buildPlan({ ...input, items: rng.shuffle(input.items), existingBlocks: rng.shuffle(input.existingBlocks) });
      expect(shuffled.blocks, `${label}: depends on input order`).toEqual(result.blocks);
      expect(shuffled.overflow).toEqual(result.overflow);

      // Persist the plan, then miss one of the next few days' blocks.
      const persisted: PlanInput = { ...input, existingBlocks: result.blocks };
      const candidates = result.blocks.filter((b) => isFresh(b) && b.date <= addDays(input.settings.today, 3));
      if (candidates.length === 0) continue;
      const target = rng.pick(candidates);
      const baseline = buildPlan(persisted);
      const after = rescheduleAfterMiss(persisted, target.key);
      rescheduled += 1;
      expectPlanInvariants({ ...persisted, existingBlocks: persisted.existingBlocks.map((b) => (b.key === target.key ? { ...b, status: 'missed' } : b)) }, after, `${label} (missed ${target.key})`);
      expect(after.blocks.find((b) => b.key === target.key)?.status).toBe('missed');
      expect(after.summary.length).toBeGreaterThan(0);
      for (const move of after.moved) {
        const block = after.blocks.find((b) => b.key === move.key);
        expect(block?.item_id).toBe(target.item_id);
        expect(block?.status).toBe('planned');
      }
      const cap = input.settings.daily_capacity_minutes;
      const overCap = Math.floor(cap * 1.25);
      const baseLoad = loads(baseline.blocks, (b) => b.status === 'planned' || b.status === 'done');
      const afterLoad = loads(after.blocks, (b) => b.status === 'planned' || b.status === 'done');
      for (const [date, minutes] of afterLoad) {
        if (date < input.settings.today) continue;
        const allowed = Math.max(overCap, baseLoad.get(date) ?? 0);
        expect(minutes, `${label}: reschedule pushed ${date} to ${minutes} (cap ${cap})`).toBeLessThanOrEqual(allowed);
      }
    }
    // The generator must actually exercise the planner.
    expect(blocksSeen).toBeGreaterThan(SEMESTERS * 10);
    expect(overflowSeen).toBeGreaterThan(0);
    expect(rescheduled).toBeGreaterThan(SEMESTERS / 2);
  }, 120_000);
});
