// buildPlan / rescheduleAfterMiss on small hand-built semesters (docs/ENGINE.md "buildPlan").
// TODAY is Tue 2026-10-27; every day is a study day unless a test says otherwise.
import { describe, expect, it } from 'vitest';
import { addDays, buildPlan, rescheduleAfterMiss } from '../index';
import type { EngineBlock, EngineItem, PlanInput } from '../types';
import {
  loadByDate,
  makeBlock,
  makeComponent,
  makeCourse,
  makeInput,
  makeItem,
  makeReading,
  makeSettings,
  makeTextbook,
  plannedFor,
  sumMinutes,
  TODAY,
} from './fixtures';

const textbook = makeTextbook({
  chapters: [
    { number: '4', title: 'Memory', start_page: 101, end_page: 126 },
    { number: '5', title: 'Learning', start_page: 127, end_page: 150 },
  ],
});

function planFor(items: EngineItem[], overrides: Partial<PlanInput> = {}) {
  return buildPlan(makeInput({ items, textbooks: [textbook], ...overrides }));
}

const fresh = (blocks: EngineBlock[]) => blocks.filter((b) => b.status === 'planned' && b.generated_by === 'engine');
const datesOf = (blocks: EngineBlock[]) => blocks.map((b) => b.date);
const minutesByDate = (blocks: EngineBlock[]) => Object.fromEntries(blocks.map((b) => [b.date, b.minutes]));

describe('buildPlan — history', () => {
  it('keeps done/missed/skipped/manual blocks, carries past planned blocks over as missed, and regenerates the future', () => {
    const hw = makeItem({ id: 'hw', title: 'Problem Set 4', estimated_minutes: 90, due_date: '2026-11-05' });
    const past = makeBlock({ key: 'hw:work:1', item_id: 'hw', date: '2026-10-25', minutes: 30 });
    const done = makeBlock({ key: 'hw:work:2', item_id: 'hw', date: '2026-10-26', minutes: 30, status: 'done' });
    const skipped = makeBlock({ key: 'hw:work:3', item_id: 'hw', date: '2026-10-24', status: 'skipped' });
    const manual = makeBlock({ key: 'my-session', item_id: 'hw', date: '2026-10-29', minutes: 20, generated_by: 'manual' });
    const future = makeBlock({ key: 'hw:work:9', item_id: 'hw', date: '2026-10-30', minutes: 45 });
    const result = planFor([hw], { existingBlocks: [past, done, skipped, manual, future] });

    expect(result.blocks).toContainEqual({ ...past, status: 'missed' });
    expect(result.blocks).toContainEqual(done);
    expect(result.blocks).toContainEqual(skipped);
    expect(result.blocks).toContainEqual(manual);
    expect(result.blocks.find((b) => b.key === 'hw:work:9')).toBeUndefined();

    // 90 min − 30 done − 20 already scheduled by hand = 40 min, inside Mon–Wed before the Thu deadline.
    const planned = fresh(result.blocks);
    expect(sumMinutes(planned)).toBe(40);
    expect(planned.every((b) => b.date >= '2026-11-02' && b.date <= '2026-11-04')).toBe(true);
  });

  it('skips done, missed, undated and overdue items', () => {
    const result = planFor([
      makeItem({ id: 'done', status: 'done' }),
      makeItem({ id: 'missed', status: 'missed' }),
      makeItem({ id: 'undated', due_date: null }),
      makeItem({ id: 'overdue', due_date: '2026-10-26' }),
      makeItem({ id: 'open', status: 'in_progress' }),
    ]);
    expect([...new Set(fresh(result.blocks).map((b) => b.item_id))]).toEqual(['open']);
  });

  it('continues a reading from the next unread page', () => {
    const reading = makeItem({
      id: 'r',
      kind: 'reading',
      title: 'Read Chapters 4–5',
      due_date: '2026-10-31',
      reading: makeReading({ textbook_id: 'tb1', chapters: ['4', '5'] }),
    });
    const done = makeBlock({ key: 'r:reading:1', item_id: 'r', kind: 'reading', date: '2026-10-26', minutes: 30, page_start: 101, page_end: 110, status: 'done' });
    const planned = fresh(planFor([reading], { existingBlocks: [done] }).blocks);
    expect(planned.map((b) => [b.date, b.page_start, b.page_end, b.label])).toEqual([
      ['2026-10-27', 111, 120, 'Read pp. 111–120 (Ch. 4)'],
      ['2026-10-28', 121, 130, 'Read pp. 121–130 (Ch. 4–5)'],
      ['2026-10-29', 131, 140, 'Read pp. 131–140 (Ch. 5)'],
      ['2026-10-30', 141, 150, 'Read pp. 141–150 (Ch. 5)'],
    ]);
    expect(sumMinutes(planned)).toBe(120); // 40 pages at 20 pages/hour
  });
});

describe('buildPlan — windows', () => {
  it('reads before class: from due − 7 (or the assigned date) to due − 1', () => {
    const base = { kind: 'reading' as const, due_date: '2026-11-05', reading: makeReading({ explicit_pages: 60 }) };
    const open = fresh(planFor([makeItem({ id: 'r', ...base })]).blocks);
    expect(open.every((b) => b.date >= '2026-10-29' && b.date <= '2026-11-04')).toBe(true);
    const assigned = fresh(planFor([makeItem({ id: 'r', ...base, assigned_date: '2026-11-02' })]).blocks);
    expect(datesOf(assigned)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('spreads homework over the three days before it is due', () => {
    const planned = fresh(planFor([makeItem({ id: 'hw', title: 'Problem Set 4', estimated_minutes: 90, due_date: '2026-11-05' })]).blocks);
    expect(minutesByDate(planned)).toEqual({ '2026-11-02': 30, '2026-11-03': 30, '2026-11-04': 30 });
    expect(planned[0].label).toBe('Work on Problem Set 4 — 30 min');
  });

  it('ramps quiz study over the two study days before the quiz', () => {
    const planned = fresh(planFor([makeItem({ id: 'q', kind: 'quiz', title: 'Quiz 3', due_date: '2026-11-05' })]).blocks);
    expect(planned.map((b) => [b.date, b.minutes, b.label])).toEqual([
      ['2026-11-03', 25, 'Study for Quiz 3 — 25 min'],
      ['2026-11-04', 35, 'Study for Quiz 3 — 35 min'],
    ]);
  });

  it('grows exam sessions toward the exam and adds a final review on due − 1', () => {
    // Weight 5% → not high impact → a four-day ramp; 215 min = 30 review + 185 study.
    const exam = makeItem({ id: 'mid', kind: 'exam', title: 'Midterm 1', weight_override: 5, due_date: '2026-11-06' });
    const planned = fresh(planFor([exam]).blocks);
    const study = planned.filter((b) => b.kind === 'study');
    expect(study.map((b) => [b.date, b.minutes])).toEqual([
      ['2026-11-02', 25],
      ['2026-11-03', 40],
      ['2026-11-04', 55],
      ['2026-11-05', 65],
    ]);
    expect(study[0].label).toBe('Study for Midterm 1 — 25 min');
    const review = planned.filter((b) => b.kind === 'review');
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ date: '2026-11-05', minutes: 30, label: 'Final review for Midterm 1 — 30 min' });
    // The review comes after the day's study session.
    expect(review[0].sort_order).toBeGreaterThan(study[3].sort_order);
  });

  it('starts high-impact exam prep a week out', () => {
    const exam = makeItem({ id: 'final', kind: 'exam', title: 'Final Exam', weight_override: 30, due_date: '2026-11-13' });
    const study = fresh(planFor([exam]).blocks).filter((b) => b.kind === 'study');
    expect(study[0].date).toBe('2026-11-06');
    expect(study[study.length - 1].date).toBe('2026-11-12');
    for (let i = 1; i < study.length; i++) expect(study[i].minutes).toBeGreaterThanOrEqual(study[i - 1].minutes);
  });

  it('collapses a window with no study day to the latest study day before the deadline, or today', () => {
    const tueToThu = makeSettings({ study_days: [2, 3, 4] });
    const reading = makeItem({ id: 'r', kind: 'reading', assigned_date: '2026-10-30', due_date: '2026-10-31', reading: makeReading({ explicit_pages: 10 }) });
    expect(datesOf(fresh(planFor([reading], { settings: tueToThu }).blocks))).toEqual(['2026-10-29']);

    const wednesdaysOnly = makeSettings({ study_days: [3] });
    const hw = makeItem({ id: 'hw', estimated_minutes: 30, due_date: '2026-10-28' });
    expect(datesOf(fresh(planFor([hw], { settings: wednesdaysOnly }).blocks))).toEqual([TODAY]);
  });
});

describe('buildPlan — papers, projects and presentations (buffer generator)', () => {
  const paper = (overrides: Partial<EngineItem> = {}) =>
    makeItem({ id: 'paper', kind: 'paper', title: 'Research Paper', due_date: '2026-11-24', ...overrides });
  const milestones = (blocks: EngineBlock[]) => fresh(blocks).filter((b) => b.kind === 'milestone').map((b) => [b.date, b.label]);

  it('starts 21 days out for high-impact work, with the full draft due two weeks before the deadline', () => {
    const blocks = planFor([paper({ weight_override: 25 })]).blocks;
    expect(milestones(blocks)).toEqual([
      ['2026-11-03', 'Start: pick topic & gather sources'],
      ['2026-11-06', 'Milestone check-in: outline'],
      ['2026-11-10', 'Milestone check-in: full draft'],
      ['2026-11-22', 'Final review & polish'],
    ]);
    const planned = fresh(blocks);
    expect(planned[0].date).toBe('2026-11-03');
    // Finished by due − 2: nothing on the day before or the day it's due.
    expect(planned.every((b) => b.date <= '2026-11-22')).toBe(true);
    expect(sumMinutes(planned)).toBe(750); // 600 × 1.25 at 25% of the grade
    expect(planned.filter((b) => b.kind === 'work')[0].label).toMatch(/^Work on Research Paper — \d+ min$/);
  });

  it('uses a 14-day lead at 10% and 7 days below that, never before the assigned date', () => {
    const firstDate = (item: EngineItem) => fresh(planFor([item]).blocks)[0].date;
    expect(firstDate(paper({ weight_override: 12, high_impact_override: false }))).toBe('2026-11-10');
    expect(firstDate(paper({ weight_override: 5 }))).toBe('2026-11-17');
    expect(firstDate(paper({ weight_override: 25, assigned_date: '2026-11-12' }))).toBe('2026-11-12');
  });

  it('spaces check-ins across the window when the work is not high impact', () => {
    expect(milestones(planFor([paper({ weight_override: 5 })]).blocks)).toEqual([
      ['2026-11-17', 'Start: pick topic & gather sources'],
      ['2026-11-19', 'Milestone check-in: outline'],
      ['2026-11-21', 'Milestone check-in: full draft'],
      ['2026-11-22', 'Final review & polish'],
    ]);
  });

  it('sorts milestones first on their day and keeps them 15–30 minutes', () => {
    const blocks = planFor([
      paper({ weight_override: 25 }),
      makeItem({ id: 'hw', title: 'Problem Set 6', estimated_minutes: 60, due_date: '2026-11-07' }),
    ]).blocks;
    const nov6 = fresh(blocks).filter((b) => b.date === '2026-11-06');
    expect(nov6[0]).toMatchObject({ kind: 'milestone', sort_order: 0 });
    for (const block of fresh(blocks).filter((b) => b.kind === 'milestone')) {
      expect(block.minutes).toBeGreaterThanOrEqual(15);
      expect(block.minutes).toBeLessThanOrEqual(30);
    }
  });

  it('asks presentations to rehearse out loud instead of polishing', () => {
    const talk = makeItem({ id: 'talk', kind: 'presentation', title: 'Group Presentation', due_date: '2026-11-24' });
    expect(milestones(planFor([talk]).blocks).pop()).toEqual(['2026-11-22', 'Rehearse out loud']);
  });

  it('skips the start check-in once work has begun, and check-ins already done', () => {
    const done = makeBlock({ key: 'paper:milestone:1', item_id: 'paper', kind: 'milestone', label: 'Milestone check-in: outline', date: '2026-10-26', status: 'done' });
    const labels = milestones(planFor([paper({ weight_override: 25 })], { existingBlocks: [done] }).blocks).map(([, label]) => label);
    expect(labels).toEqual(['Milestone check-in: full draft', 'Final review & polish']);
  });

  it('never schedules a paper on the day before or the day it is due when a short window is full', () => {
    const tight = paper({ estimated_minutes: 600, due_date: '2026-10-31' });
    const result = planFor([tight], { settings: makeSettings({ daily_capacity_minutes: 60 }) });
    expect(fresh(result.blocks).every((b) => b.date <= '2026-10-29')).toBe(true);
    expect(result.overflow.map((w) => w.item_id)).toEqual(['paper']);
  });
});

describe('buildPlan — pop-quiz reviews', () => {
  it('adds a 10-minute review on class days in the next two weeks that have nothing else for the course', () => {
    const course = makeCourse({ policies: { unannounced_quizzes: true }, meeting_days: [1, 3] }); // Mon, Wed
    const result = planFor(
      [
        makeItem({ id: 'hwA', estimated_minutes: 90, due_date: '2026-11-05' }), // Mon 11-02 … Wed 11-04
        makeItem({ id: 'hwB', estimated_minutes: 45, due_date: '2026-11-20' }),
      ],
      { courses: [course] },
    );
    const reviews = fresh(result.blocks).filter((b) => b.label === 'Review notes — pop quiz risk');
    expect(reviews.map((b) => [b.date, b.item_id, b.minutes, b.kind])).toEqual([
      ['2026-10-28', 'hwA', 10, 'review'],
      ['2026-11-09', 'hwB', 10, 'review'],
    ]);
  });

  it('does nothing for courses without the policy', () => {
    const result = planFor([makeItem({ id: 'hw', due_date: '2026-11-20' })], { courses: [makeCourse({ meeting_days: [1, 3] })] });
    expect(fresh(result.blocks).some((b) => b.label === 'Review notes — pop quiz risk')).toBe(false);
  });
});

describe('buildPlan — load balancing', () => {
  it('never exceeds daily capacity when there is room', () => {
    const items = [
      makeItem({ id: 'a', estimated_minutes: 120, due_date: '2026-10-31' }),
      makeItem({ id: 'b', kind: 'quiz', title: 'Quiz 2', due_date: '2026-10-30' }),
      makeItem({ id: 'c', kind: 'reading', due_date: '2026-11-01', reading: makeReading({ textbook_id: 'tb1', chapters: ['4'] }) }),
      makeItem({ id: 'd', kind: 'exam', title: 'Midterm 1', weight_override: 20, due_date: '2026-11-04' }),
      makeItem({ id: 'e', kind: 'lab', due_date: '2026-11-02' }),
    ];
    const result = planFor(items, { settings: makeSettings({ daily_capacity_minutes: 150 }) });
    expect(result.overflow).toEqual([]);
    for (const minutes of loadByDate(result.blocks).values()) expect(minutes).toBeLessThanOrEqual(150);
    expect(result.days.every((d) => !d.overloaded)).toBe(true);
  });

  it('fills the lightest days first and leaves a busy day alone', () => {
    const busy = makeBlock({ key: 'other', item_id: 'x', date: '2026-11-03', minutes: 60, generated_by: 'manual' });
    const planned = plannedFor(planFor([makeItem({ id: 'hw', estimated_minutes: 90, due_date: '2026-11-05' })], { existingBlocks: [busy] }).blocks, 'hw');
    expect(minutesByDate(planned)).toEqual({ '2026-11-02': 45, '2026-11-04': 45 });
  });

  it('breaks ties toward the earlier day', () => {
    const planned = fresh(planFor([makeItem({ id: 'hw', estimated_minutes: 15, due_date: '2026-11-05' })]).blocks);
    expect(minutesByDate(planned)).toEqual({ '2026-11-02': 15 });
  });

  it('skips blackout dates and days that are not study days', () => {
    const settings = makeSettings({ study_days: [1, 2, 3, 4, 5], blackout_dates: ['2026-11-03'] });
    const planned = fresh(planFor([makeItem({ id: 'hw', estimated_minutes: 90, due_date: '2026-11-05' })], { settings }).blocks);
    expect(minutesByDate(planned)).toEqual({ '2026-11-02': 45, '2026-11-04': 45 });
  });

  it('splits readings into whole pages, at least five per block', () => {
    const reading = makeItem({ id: 'r', kind: 'reading', due_date: '2026-11-01', reading: makeReading({ explicit_pages: 12 }) });
    const planned = fresh(planFor([reading]).blocks);
    expect(planned.map((b) => [b.page_start, b.page_end])).toEqual([
      [1, 6],
      [7, 12],
    ]);
  });

  it('places higher-impact work first when deadlines tie', () => {
    const settings = makeSettings({ daily_capacity_minutes: 60 });
    const result = planFor(
      [
        makeItem({ id: 'a-low', title: 'Worksheet', estimated_minutes: 90, weight_override: 2, due_date: '2026-10-28' }),
        makeItem({ id: 'z-high', title: 'Lab Report', estimated_minutes: 90, weight_override: 20, due_date: '2026-10-28' }),
      ],
      { settings },
    );
    expect(sumMinutes(plannedFor(result.blocks, 'z-high'))).toBe(90);
    expect(result.overflow.map((w) => w.item_id)).toEqual(['a-low']);
  });
});

describe('buildPlan — overflow', () => {
  it('uses up to 125% of capacity, then the due date, then warns instead of piling onto one day', () => {
    const hw = makeItem({ id: 'hw', title: 'Problem Set 4', estimated_minutes: 300, due_date: '2026-10-29' });
    const result = planFor([hw], { settings: makeSettings({ daily_capacity_minutes: 60 }) });
    expect(minutesByDate(fresh(result.blocks))).toEqual({ '2026-10-27': 75, '2026-10-28': 75, '2026-10-29': 75 });
    expect(result.overflow).toEqual([
      expect.objectContaining({ item_id: 'hw', unplacedMinutes: 75, message: "Couldn't fit 1h 15m of PSY 101 Problem Set 4 before it's due Thu, Oct 29." }),
    ]);
  });

  it('suggests starting earlier when there is free time before the window', () => {
    // 5% of the grade → 7-day lead → the window opens Fri Oct 30, but Tue–Thu are free.
    const paper = makeItem({ id: 'paper', kind: 'paper', title: 'Research Paper', weight_override: 5, estimated_minutes: 900, due_date: '2026-11-06' });
    const result = planFor([paper], { settings: makeSettings({ daily_capacity_minutes: 100 }) });
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0].suggestion).toBe('Start PSY 101 Research Paper by Oct 28');
  });

  it('suggests dropping low-impact readings that crowd out important work', () => {
    const settings = makeSettings({ daily_capacity_minutes: 60 });
    const readings = ['r1', 'r2'].map((id) =>
      makeItem({ id, kind: 'reading', title: `Article ${id}`, due_date: '2026-10-29', reading: makeReading({ explicit_pages: 20 }) }),
    );
    const exam = makeItem({ id: 'exam', kind: 'exam', title: 'Midterm 1', weight_override: 30, estimated_minutes: 200, due_date: '2026-10-30' });
    const result = planFor([...readings, exam], { settings });
    const warning = result.overflow.find((w) => w.item_id === 'exam');
    expect(warning?.suggestion).toMatch(/^Drop [12] low-impact readings? this week$/);
  });

  it('explains when there is no study time left at all', () => {
    const paper = makeItem({ id: 'paper', kind: 'paper', title: 'Research Paper', estimated_minutes: 120, due_date: TODAY });
    const [warning] = planFor([paper]).overflow;
    expect(warning.unplacedMinutes).toBe(120);
    expect(warning.suggestion).toMatch(/^There's no study time left before it's due/);
  });
});

describe('buildPlan — keys, labels and days', () => {
  it('numbers keys per item past the highest number in history', () => {
    const done = makeBlock({ key: 'hw:work:7', item_id: 'hw', date: '2026-10-26', minutes: 15, status: 'done' });
    const planned = fresh(planFor([makeItem({ id: 'hw', estimated_minutes: 90, due_date: '2026-11-05' })], { existingBlocks: [done] }).blocks);
    expect(planned.map((b) => b.key)).toEqual(['hw:work:8', 'hw:work:9', 'hw:work:10']);
  });

  it('is idempotent: replanning a persisted plan reproduces the same blocks and keys', () => {
    const input = makeInput({
      textbooks: [textbook],
      items: [
        makeItem({ id: 'hw', estimated_minutes: 90, due_date: '2026-11-05' }),
        makeItem({ id: 'mid', kind: 'exam', title: 'Midterm 1', weight_override: 25, due_date: '2026-11-10' }),
        makeItem({ id: 'r', kind: 'reading', due_date: '2026-11-02', reading: makeReading({ textbook_id: 'tb1', chapters: ['5'] }) }),
      ],
    });
    const first = buildPlan(input);
    const second = buildPlan({ ...input, existingBlocks: first.blocks });
    expect(second.blocks).toEqual(first.blocks);
  });

  it('labels reading blocks with page numbers and chapters', () => {
    const reading = makeItem({ id: 'r', kind: 'reading', title: 'Memory', due_date: '2026-10-28', reading: makeReading({ textbook_id: 'tb1', chapters: ['4'] }) });
    expect(fresh(planFor([reading]).blocks).map((b) => b.label)).toEqual(['Read pp. 101–126 (Ch. 4)']);

    const relative = makeItem({ id: 'n', kind: 'reading', title: 'Chapter 7 notes', due_date: '2026-10-29', reading: makeReading({ explicit_pages: 40 }) });
    expect(fresh(planFor([relative]).blocks).map((b) => b.label)).toEqual([
      'Read pages 1–20 of 40 (Chapter 7 notes)',
      'Read pages 21–40 of 40 (Chapter 7 notes)',
    ]);
  });

  it('covers today through the latest due date, at most 180 days', () => {
    const near = planFor([makeItem({ due_date: '2026-11-05' })]);
    expect(near.days[0].date).toBe(TODAY);
    expect(near.days[near.days.length - 1].date).toBe('2026-11-05');
    const far = planFor([makeItem({ due_date: '2027-09-01' })]);
    expect(far.days).toHaveLength(180);
    expect(far.days[179].date).toBe(addDays(TODAY, 179));
  });

  it('annotates every input item', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b', status: 'done' }), makeItem({ id: 'c', due_date: null })];
    expect(planFor(items).annotated.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores archived courses', () => {
    const result = planFor([makeItem({ id: 'hw' })], { courses: [makeCourse({ archived: true })] });
    expect(fresh(result.blocks)).toEqual([]);
  });
});

describe('rescheduleAfterMiss', () => {
  const chapter4 = makeTextbook({ chapters: [{ number: '4', title: 'Memory', start_page: 101, end_page: 160 }] });
  const reading = makeItem({
    id: 'r',
    kind: 'reading',
    title: 'Memory',
    due_date: '2026-10-31', // Sat → read Tue–Fri
    reading: makeReading({ textbook_id: 'tb1', chapters: ['4'] }),
  });

  function persisted(items: EngineItem[], overrides: Partial<PlanInput> = {}): PlanInput {
    const input = makeInput({ items, textbooks: [chapter4], ...overrides });
    return { ...input, existingBlocks: buildPlan(input).blocks };
  }

  it('keeps the missed block in history and spreads its pages over the days left', () => {
    const input = persisted([reading]);
    const missed = input.existingBlocks.find((b) => b.date === TODAY);
    expect(missed).toMatchObject({ page_start: 101, page_end: 115 });
    const result = rescheduleAfterMiss(input, missed?.key ?? '');

    expect(result.blocks).toContainEqual({ ...missed, status: 'missed' });
    expect(fresh(result.blocks).map((b) => [b.date, b.label, b.minutes])).toEqual([
      ['2026-10-28', 'Read pp. 101–120 (Ch. 4)', 60],
      ['2026-10-29', 'Read pp. 121–140 (Ch. 4)', 60],
      ['2026-10-30', 'Read pp. 141–160 (Ch. 4)', 60],
    ]);
    expect(result.summary).toBe('Moved 15 pages of PSY 101 reading across Wed–Fri');
    expect(result.moved).toEqual(fresh(result.blocks).map((b) => ({ key: b.key, date: b.date, minutes: b.minutes })));
  });

  it('never pushes a day over capacity when the remaining days have room', () => {
    const settings = makeSettings({ daily_capacity_minutes: 120 });
    const items = [
      makeItem({ id: 'hw', estimated_minutes: 120, due_date: '2026-10-30' }),
      makeItem({ id: 'lab', kind: 'lab', estimated_minutes: 120, due_date: '2026-10-31' }),
    ];
    const input = persisted(items, { settings });
    const target = input.existingBlocks.find((b) => b.item_id === 'hw' && b.date === TODAY);
    expect(target).toBeDefined();
    const result = rescheduleAfterMiss(input, target?.key ?? '');
    expect(result.overflow).toEqual([]);
    for (const [date, minutes] of loadByDate(result.blocks)) if (date >= TODAY) expect(minutes).toBeLessThanOrEqual(120);
    expect(sumMinutes(plannedFor(result.blocks, 'hw'))).toBe(120);
    expect(plannedFor(result.blocks, 'hw').every((b) => b.date !== TODAY)).toBe(true);
    expect(result.summary).toMatch(/^Moved \d+ min of PSY 101 Problem Set 1 across /);
  });

  it('falls back to the overflow suggestion when no room is left', () => {
    // Due today: the only day left is today, and today's session is the one being missed.
    const hw = makeItem({ id: 'hw', estimated_minutes: 60, due_date: TODAY });
    const input = persisted([hw], { settings: makeSettings({ daily_capacity_minutes: 60 }) });
    const target = input.existingBlocks.find((b) => b.item_id === 'hw');
    const result = rescheduleAfterMiss(input, target?.key ?? '');
    const warning = result.overflow.find((w) => w.item_id === 'hw');
    expect(warning).toBeDefined();
    expect(result.summary).toBe(warning?.suggestion);
  });

  it('reports an unknown block without changing the plan', () => {
    const input = persisted([reading]);
    const result = rescheduleAfterMiss(input, 'nope');
    expect(result.blocks).toEqual(buildPlan(input).blocks);
    expect(result.moved).toEqual([]);
    expect(result.summary).toMatch(/no longer in your plan/);
  });
});

describe('effective weight inside the planner', () => {
  it('splits component weights across expected items when sizing work', () => {
    const result = planFor(
      [makeItem({ id: 'mid', kind: 'exam', title: 'Midterm 1', component_id: 'exams', due_date: '2026-11-10' })],
      { components: [makeComponent({ id: 'exams', weight: 50, expected_count: 2 })] },
    );
    expect(result.annotated[0].impact.weight).toBe(25);
    expect(result.annotated[0].effortMinutes).toBe(450);
  });
});
