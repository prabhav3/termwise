import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineBlock } from '@/engine';
import type { Course, Item, PlanBlock, Profile } from '@/types/db';

// The planner glue against an in-memory plan_blocks table: the query layer, Supabase and the
// native modules are stubbed; the engine and the persist/replan logic are real.
const db = vi.hoisted(() => ({
  profile: null as unknown,
  courses: [] as unknown[],
  items: [] as unknown[],
  blocks: [] as PlanBlock[],
  nextId: 1,
  /** When set, the next plan_blocks upsert lands only once this resolves (a slow request). */
  holdNextUpsert: null as Promise<void> | null,
}));

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) }, Platform: { OS: 'ios' } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('@/lib/notifications', () => ({ scheduleTriageNotifications: async () => 0 }));
vi.mock('@/lib/storage', () => ({ readString: async () => null, writeString: async () => undefined, storageKeys: {} }));
vi.mock('@/lib/query-client', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }) };
});

function list<T>(key: string, rows: () => T[]) {
  return () => ({ queryKey: [key], queryFn: async () => rows() });
}
vi.mock('@/data/courses', () => ({ coursesQueryOptions: list('courses', () => db.courses) }));
vi.mock('@/data/components', () => ({ componentsQueryOptions: list('components', () => []) }));
vi.mock('@/data/items', () => ({ itemsQueryOptions: list('items', () => db.items) }));
vi.mock('@/data/textbooks', () => ({ textbooksQueryOptions: list('textbooks', () => []) }));
vi.mock('@/data/termEvents', () => ({ termEventsQueryOptions: list('termEvents', () => []) }));
vi.mock('@/data/profile', () => ({
  profileQueryOptions: (userId: string) => ({ queryKey: ['profile', userId], queryFn: async () => db.profile }),
}));
vi.mock('@/data/planBlocks', () => ({
  planBlocksQueryOptions: () => ({
    queryKey: ['planBlocks'],
    queryFn: async () => db.blocks.map((row) => ({ ...row })),
  }),
}));

vi.mock('@/lib/supabase', () => {
  const ok = <T>(data: T) => ({ data, error: null });
  const planBlocks = {
    upsert: (rows: Omit<PlanBlock, 'id' | 'created_at' | 'updated_at'>[]) => ({
      select: async () => {
        const hold = db.holdNextUpsert;
        db.holdNextUpsert = null;
        if (hold) await hold;
        return ok(
          rows.map((row) => {
            const existing = db.blocks.find((block) => block.key === row.key);
            if (existing) {
              Object.assign(existing, row);
              return { ...existing };
            }
            const created: PlanBlock = { ...row, id: `b${db.nextId++}`, created_at: 'now', updated_at: 'now' };
            db.blocks.push(created);
            return { ...created };
          }),
        );
      },
    }),
    delete: () => ({
      in: async (_column: string, ids: string[]) => {
        db.blocks = db.blocks.filter((block) => !ids.includes(block.id));
        return ok(null);
      },
    }),
    update: (changes: Partial<PlanBlock>) => ({
      eq: (_column: string, id: string) => ({
        select: () => ({
          single: async () => {
            const row = db.blocks.find((block) => block.id === id);
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'No rows', details: null } };
            Object.assign(row, changes);
            return ok({ ...row });
          },
        }),
      }),
    }),
  };
  return {
    SUPABASE_URL: 'http://localhost:54321',
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: (table: string) => {
        if (table !== 'plan_blocks') throw new Error(`unexpected table ${table}`);
        return planBlocks;
      },
    },
  };
});

const { buildPlan } = await import('@/engine');
const { queryClient } = await import('@/lib/query-client');
const planner = await import('./planner');
const { buildPlanInput, markBlockDone, markBlockMissed, replan, sameWork } = planner;

const TODAY = '2026-10-27';

const profile = {
  id: 'u1',
  timezone: 'UTC',
  study_days: [0, 1, 2, 3, 4, 5, 6],
  daily_capacity_minutes: 60,
  reading_pages_per_hour: 20,
  default_pages_per_chapter: 25,
  high_impact_threshold: 15,
  blackout_dates: [],
} as unknown as Profile;

const course = {
  id: 'c1',
  title: 'Intro to Psychology',
  code: 'PSY 101',
  color: '#ff5c00',
  credits: 3,
  meeting_days: [],
  start_date: '2026-08-31',
  end_date: '2026-12-18',
  target_percent: null,
  grade_scale: [],
  policies: {},
} as unknown as Course;

const reading = {
  id: 'i1',
  course_id: 'c1',
  component_id: null,
  title: 'Chapters 4-6',
  kind: 'reading',
  assigned_date: null,
  due_date: '2026-11-03',
  due_time: null,
  weight_override: null,
  points_possible: null,
  score: null,
  estimated_minutes: null,
  reading: null,
  pages: 120,
  status: 'todo',
  high_impact_override: null,
  is_major: false,
} as unknown as Item;

/** What usePlan shows: the plan computed in memory from the stored rows. */
function planOnScreen(): EngineBlock[] {
  const source = { profile, courses: [course], components: [], items: [reading], textbooks: [], termEvents: [], blocks: db.blocks };
  return buildPlan(buildPlanInput(source, TODAY)).blocks;
}

function stored(key: string): PlanBlock {
  const row = db.blocks.find((block) => block.key === key);
  if (!row) throw new Error(`no stored block ${key}`);
  return row;
}

/** Saves a plan, then shifts one of today's stored chunks so the same key names other pages. */
async function staleSavedChunk(): Promise<EngineBlock> {
  await replan();
  const shown = planOnScreen().find((block) => block.date === TODAY && block.kind === 'reading' && block.status === 'planned');
  if (!shown || shown.page_start === null || shown.page_end === null) throw new Error('fixture: no reading block today');
  const row = stored(shown.key);
  row.page_start = shown.page_start + 20;
  row.page_end = shown.page_end + 20;
  queryClient.setQueryData(['planBlocks'], db.blocks.map((block) => ({ ...block })));
  expect(sameWork(stored(shown.key), shown)).toBe(false);
  // The engine rebuilds the same chunk under the same key from the stale rows.
  expect(planOnScreen().find((block) => block.key === shown.key)).toMatchObject({ page_start: shown.page_start, page_end: shown.page_end });
  return shown;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  db.profile = profile;
  db.courses = [course];
  db.items = [reading];
  db.blocks = [];
  db.holdNextUpsert = null;
  queryClient.clear();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('markBlockDone', () => {
  it('marks the pages shown done when the stored row under that key holds other pages', async () => {
    const shown = await staleSavedChunk();

    await markBlockDone(shown);

    expect(stored(shown.key)).toMatchObject({ status: 'done', page_start: shown.page_start, page_end: shown.page_end });
    expect(stored(shown.key).completed_at).not.toBeNull();
  });

  it('is not reverted by a replan that loaded the blocks before the tick', async () => {
    const shown = await staleSavedChunk();
    let release = () => undefined as void;
    db.holdNextUpsert = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The daily replan has read the stale rows; its write (planned, from that read) is slow.
    const running = replan();
    const ticking = markBlockDone(shown);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([running, ticking]);

    expect(stored(shown.key)).toMatchObject({ status: 'done', page_start: shown.page_start, page_end: shown.page_end });
    // The follow-up replan keeps it done and plans only the rest.
    await replan();
    expect(stored(shown.key).status).toBe('done');
  });

  it('refuses a block that no longer matches the saved plan', async () => {
    await replan();
    const shown = planOnScreen().find((block) => block.date === TODAY && block.status === 'planned');
    if (!shown) throw new Error('fixture: no block today');

    await expect(markBlockDone({ ...shown, page_end: (shown.page_end ?? 0) + 99 })).rejects.toMatchObject({ code: 'conflict' });
    expect(db.blocks.some((block) => block.status === 'done')).toBe(false);
  });
});

describe('markBlockMissed', () => {
  it('marks the pages shown missed when the stored row under that key holds other pages', async () => {
    const shown = await staleSavedChunk();

    await markBlockMissed(shown);

    expect(stored(shown.key)).toMatchObject({ status: 'missed', page_start: shown.page_start, page_end: shown.page_end });
  });
});
