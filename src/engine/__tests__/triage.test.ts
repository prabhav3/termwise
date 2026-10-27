import { describe, expect, it } from 'vitest';
import { annotateItems, triageForDate } from '../index';
import type { EngineBlock, EngineCourse, EngineItem, PlanResult } from '../types';
import { makeBlock, makeCourse, makeInput, makeItem, makeSettings, TODAY } from './fixtures';

const courses = [
  makeCourse({ id: 'c1', code: 'PSY 101' }),
  makeCourse({ id: 'c2', code: 'HIST 210', title: 'Modern Europe' }),
  makeCourse({ id: 'c3', code: 'BIO 110', title: 'Cells' }),
];
const settings = makeSettings();

function planOf(items: EngineItem[], blocks: EngineBlock[] = [], list: EngineCourse[] = courses): PlanResult {
  return { blocks, days: [], overflow: [], annotated: annotateItems(makeInput({ courses: list, items })) };
}

// Impact scores: plain homework/reading 8, quiz 13, a 30% exam 87.
const items = [
  makeItem({ id: 'lab', title: 'Lab Report', due_date: '2026-10-25' }), // overdue: 4 + 60
  makeItem({ id: 'quiz', kind: 'quiz', title: 'Quiz 2', due_date: TODAY }), // due today: 6.5 + 50
  makeItem({ id: 'read', kind: 'reading', title: 'Memory', due_date: '2026-10-28' }), // tomorrow + block: 4 + 40 + 20
  makeItem({ id: 'later', title: 'Problem Set 5', due_date: '2026-11-01' }), // 5 days, no block: not a candidate
  makeItem({ id: 'ps4', title: 'Problem Set 4', due_date: '2026-11-01' }), // 5 days + block: 4 + 15 + 20
  makeItem({ id: 'old', title: 'Done Thing', due_date: '2026-10-20', status: 'done' }),
];
const blocks = [
  makeBlock({ key: 'read:reading:1', item_id: 'read', kind: 'reading', minutes: 78, label: 'Read pp. 101–126 (Ch. 4)', page_start: 101, page_end: 126 }),
  makeBlock({ key: 'ps4:work:2', item_id: 'ps4', minutes: 30, label: 'Work on Problem Set 4 — 30 min', sort_order: 2 }),
  makeBlock({ key: 'ps4:work:1', item_id: 'ps4', minutes: 20, label: 'Work on Problem Set 4 — 20 min', sort_order: 1 }),
  makeBlock({ key: 'ps4:work:3', item_id: 'ps4', minutes: 20, date: '2026-10-28', label: 'Tomorrow' }),
];

describe('triageForDate', () => {
  it('returns the top 3 by priority, breaking ties by due date', () => {
    const actions = triageForDate(planOf(items, blocks), courses, settings);
    expect(actions.map((a) => [a.item_id, a.priority, a.reason])).toEqual([
      ['lab', 64, 'overdue'],
      ['read', 64, 'due_soon'],
      ['quiz', 56.5, 'due_today'],
    ]);
  });

  it('includes items with a block today and skips everything else', () => {
    const actions = triageForDate(planOf(items, blocks), courses, settings, undefined, 10);
    expect(actions.map((a) => a.item_id)).toEqual(['lab', 'read', 'quiz', 'ps4']);
    expect(actions[3]).toMatchObject({ priority: 39, reason: 'planned_today' });
  });

  it("uses the day's block label and minutes when there is one (one action per item)", () => {
    const actions = triageForDate(planOf(items, blocks), courses, settings, undefined, 10);
    expect(actions.find((a) => a.item_id === 'read')).toEqual({
      key: `triage:read:${TODAY}`,
      item_id: 'read',
      block_key: 'read:reading:1',
      course_id: 'c1',
      title: 'Read pp. 101–126 (Ch. 4)',
      subtitle: 'PSY 101 · Memory · due tomorrow',
      minutes: 78,
      priority: 64,
      reason: 'due_soon',
    });
    expect(actions.filter((a) => a.item_id === 'ps4')).toEqual([
      expect.objectContaining({ block_key: 'ps4:work:1', title: 'Work on Problem Set 4 — 20 min', minutes: 20, subtitle: 'PSY 101 · due Sun' }),
    ]);
  });

  it('names a concrete step and minutes when there is no block', () => {
    const actions = triageForDate(planOf(items, blocks), courses, settings);
    expect(actions.find((a) => a.item_id === 'lab')).toMatchObject({
      block_key: null,
      title: 'Finish Lab Report — 60 min',
      minutes: 60,
      subtitle: 'PSY 101 · was due Sun, Oct 25',
    });
    expect(actions.find((a) => a.item_id === 'quiz')).toMatchObject({ title: 'Final review for Quiz 2 — 60 min', minutes: 60 });
  });

  it('asks for a score instead of more study when a test is overdue', () => {
    const [action] = triageForDate(planOf([makeItem({ id: 'q', kind: 'quiz', title: 'Quiz 1', due_date: '2026-10-23' })]), courses, settings);
    expect(action).toMatchObject({ title: 'Mark Quiz 1 as done and add your score', minutes: 5, reason: 'overdue' });
  });

  it('pulls in high-impact work from a red zone starting within a week', () => {
    const exams = (due: string) =>
      ['c1', 'c2', 'c3'].map((course_id) =>
        makeItem({ id: `${course_id}-${due}`, course_id, kind: 'exam', title: `Midterm ${course_id}`, weight_override: 30, due_date: due }),
      );
    const soon = triageForDate(planOf(exams('2026-11-02')), courses, settings);
    expect(soon.map((a) => [a.title, a.priority, a.reason])).toEqual([
      ['Get ahead on Midterm c1 — 60 min', 58.5, 'red_zone_prep'],
      ['Get ahead on Midterm c2 — 60 min', 58.5, 'red_zone_prep'],
      ['Get ahead on Midterm c3 — 60 min', 58.5, 'red_zone_prep'],
    ]);
    expect(triageForDate(planOf(exams('2026-11-06')), courses, settings)).toEqual([]);
  });

  it('breaks equal priorities by due date, then title', () => {
    const tie = [
      makeItem({ id: 'x', title: 'Zebra', due_date: '2026-11-01' }),
      makeItem({ id: 'y', title: 'Apple', due_date: '2026-11-01' }),
      makeItem({ id: 'z', title: 'Mango', due_date: '2026-10-30' }),
    ];
    const tieBlocks = tie.map((item) => makeBlock({ key: `${item.id}:work:1`, item_id: item.id, label: `Work on ${item.title} — 30 min` }));
    expect(triageForDate(planOf(tie, tieBlocks), courses, settings).map((a) => a.item_id)).toEqual(['z', 'y', 'x']);
  });

  it('triages any date and respects the limit, skipping archived courses', () => {
    // On Wednesday the quiz is overdue (6.5 + 60) and outranks everything else.
    const tomorrow = triageForDate(planOf(items, blocks), courses, settings, '2026-10-28', 1);
    expect(tomorrow).toEqual([expect.objectContaining({ item_id: 'quiz', reason: 'overdue', priority: 66.5, key: 'triage:quiz:2026-10-28' })]);
    const wednesday = triageForDate(planOf(items, blocks), courses, settings, '2026-10-28', 10);
    expect(wednesday.find((a) => a.item_id === 'read')).toMatchObject({ reason: 'due_today', priority: 54, title: 'Read Memory — 60 min' });
    expect(wednesday.find((a) => a.item_id === 'ps4')).toMatchObject({ block_key: 'ps4:work:3', minutes: 20 });
    const archived = courses.map((c) => ({ ...c, archived: true }));
    expect(triageForDate(planOf(items, blocks, archived), archived, settings)).toEqual([]);
  });
});
