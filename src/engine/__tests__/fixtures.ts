// Small builders for hand-made engine fixtures. TODAY is a Tuesday.
import type {
  EngineBlock,
  EngineComponent,
  EngineCourse,
  EngineItem,
  EngineReading,
  EngineTermEvent,
  EngineTextbook,
  ISODate,
  PlanInput,
  PlannerSettings,
} from '../types';

export const TODAY: ISODate = '2026-10-27';

export function makeSettings(overrides: Partial<PlannerSettings> = {}): PlannerSettings {
  return {
    today: TODAY,
    study_days: [0, 1, 2, 3, 4, 5, 6],
    daily_capacity_minutes: 180,
    reading_pages_per_hour: 20,
    default_pages_per_chapter: 25,
    high_impact_threshold: 15,
    blackout_dates: [],
    ...overrides,
  };
}

export function makeCourse(overrides: Partial<EngineCourse> = {}): EngineCourse {
  return {
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
    ...overrides,
  };
}

export function makeComponent(overrides: Partial<EngineComponent> = {}): EngineComponent {
  return {
    id: 'comp1',
    course_id: 'c1',
    name: 'Exams',
    weight: 50,
    expected_count: null,
    drop_lowest: 0,
    ...overrides,
  };
}

export function makeReading(overrides: Partial<EngineReading> = {}): EngineReading {
  return { textbook_id: null, chapters: [], page_ranges: [], explicit_pages: null, description: null, ...overrides };
}

export function makeItem(overrides: Partial<EngineItem> = {}): EngineItem {
  return {
    id: 'i1',
    course_id: 'c1',
    component_id: null,
    title: 'Problem Set 1',
    kind: 'homework',
    assigned_date: null,
    due_date: '2026-11-05',
    due_time: null,
    weight_override: null,
    points_possible: null,
    score: null,
    estimated_minutes: null,
    reading: null,
    pages: null,
    status: 'todo',
    high_impact_override: null,
    is_major: false,
    ...overrides,
  };
}

export function makeBlock(overrides: Partial<EngineBlock> = {}): EngineBlock {
  return {
    key: 'i1:work:1',
    item_id: 'i1',
    course_id: 'c1',
    date: TODAY,
    minutes: 30,
    kind: 'work',
    label: 'Work on Problem Set 1 — 30 min',
    page_start: null,
    page_end: null,
    status: 'planned',
    sort_order: 0,
    generated_by: 'engine',
    ...overrides,
  };
}

export function makeTextbook(overrides: Partial<EngineTextbook> = {}): EngineTextbook {
  return { id: 'tb1', course_id: 'c1', title: 'Psychology, 4th ed.', chapters: [], ...overrides };
}

export function makeTermEvent(overrides: Partial<EngineTermEvent> = {}): EngineTermEvent {
  return {
    id: 't1',
    course_id: 'c1',
    title: 'Thanksgiving Break',
    kind: 'break',
    start_date: '2026-11-25',
    end_date: '2026-11-27',
    ...overrides,
  };
}

export function makeInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    courses: [makeCourse()],
    components: [],
    items: [],
    textbooks: [],
    termEvents: [],
    existingBlocks: [],
    settings: makeSettings(),
    ...overrides,
  };
}

/** Planned (+ done) minutes per date across a block list. */
export function loadByDate(blocks: EngineBlock[]): Map<ISODate, number> {
  const loads = new Map<ISODate, number>();
  for (const b of blocks) {
    if (b.status !== 'planned' && b.status !== 'done') continue;
    loads.set(b.date, (loads.get(b.date) ?? 0) + b.minutes);
  }
  return loads;
}

export function plannedFor(blocks: EngineBlock[], itemId: string): EngineBlock[] {
  return blocks.filter((b) => b.item_id === itemId && b.status === 'planned');
}

export function sumMinutes(blocks: EngineBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.minutes, 0);
}
