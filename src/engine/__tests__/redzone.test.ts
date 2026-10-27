import { describe, expect, it } from 'vitest';
import { annotateItems, detectRedZones, stressLevel, weeklyStress } from '../index';
import type { EngineItem, PlanResult } from '../types';
import { makeBlock, makeCourse, makeInput, makeItem, makeSettings, TODAY } from './fixtures';

const courses = [
  makeCourse({ id: 'c1', code: 'PSY 101' }),
  makeCourse({ id: 'c2', code: 'HIST 210', title: 'Modern Europe' }),
  makeCourse({ id: 'c3', code: 'BIO 110', title: 'Cells' }),
];

function annotate(items: EngineItem[]) {
  return annotateItems(makeInput({ courses, items }));
}

const exam = (id: string, course_id: string, due_date: string, title = `Exam ${id}`) =>
  makeItem({ id, course_id, kind: 'exam', title, due_date, weight_override: 30 });
const homework = (id: string, due_date: string, overrides: Partial<EngineItem> = {}) =>
  makeItem({ id, kind: 'homework', title: `Homework ${id}`, due_date, ...overrides });

describe('detectRedZones', () => {
  it('flags 3 major deadlines within 48 hours as red', () => {
    const zones = detectRedZones(
      annotate([
        exam('mid', 'c1', '2026-11-02', 'Midterm 1'),
        makeItem({ id: 'essay', course_id: 'c2', kind: 'paper', title: 'Research Paper', due_date: '2026-11-02' }),
        makeItem({ id: 'proj', course_id: 'c1', kind: 'project', title: 'Group Project', due_date: '2026-11-03' }),
      ]),
      courses,
      { from: TODAY },
    );
    expect(zones).toEqual([
      {
        start: '2026-11-02',
        end: '2026-11-03',
        severity: 'red',
        items: [
          { id: 'mid', course_id: 'c1', title: 'Midterm 1', kind: 'exam', due_date: '2026-11-02' },
          { id: 'essay', course_id: 'c2', title: 'Research Paper', kind: 'paper', due_date: '2026-11-02' },
          { id: 'proj', course_id: 'c1', title: 'Group Project', kind: 'project', due_date: '2026-11-03' },
        ],
        courseIds: ['c1', 'c2'],
        message: '3 major deadlines in 48 hours across PSY 101, HIST 210',
      },
    ]);
  });

  it('counts high-impact work that is not a major kind', () => {
    const items = ['a', 'b', 'c'].map((id) => homework(id, '2026-11-02', { weight_override: 20 }));
    expect(detectRedZones(annotate(items), courses, { from: TODAY }).map((z) => z.severity)).toEqual(['red']);
  });

  it('flags 2 major deadlines from different courses as orange, but not from the same course', () => {
    const cross = detectRedZones(annotate([exam('a', 'c1', '2026-11-02'), exam('b', 'c2', '2026-11-03')]), courses, { from: TODAY });
    expect(cross.map((z) => [z.severity, z.message])).toEqual([['orange', '2 major deadlines in 48 hours across PSY 101, HIST 210']]);
    const same = detectRedZones(annotate([exam('a', 'c1', '2026-11-02'), exam('b', 'c1', '2026-11-03')]), courses, { from: TODAY });
    expect(same).toEqual([]);
  });

  it('flags 4 deadlines of any kind as orange', () => {
    const items = ['a', 'b', 'c', 'd'].map((id, i) => homework(id, i < 2 ? '2026-11-02' : '2026-11-03'));
    const zones = detectRedZones(annotate(items), courses, { from: TODAY });
    expect(zones.map((z) => [z.severity, z.message])).toEqual([['orange', '4 deadlines in 48 hours for PSY 101']]);
    expect(detectRedZones(annotate(items.slice(0, 3)), courses, { from: TODAY })).toEqual([]);
  });

  it('only looks at a 48-hour window: majors on three consecutive days are orange, not red', () => {
    const zones = detectRedZones(
      annotate([exam('a', 'c1', '2026-11-02'), exam('b', 'c2', '2026-11-03'), exam('c', 'c3', '2026-11-04')]),
      courses,
      { from: TODAY },
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ start: '2026-11-02', end: '2026-11-04', severity: 'orange' });
    expect(zones[0].message).toBe('3 major deadlines in 72 hours across PSY 101, HIST 210, BIO 110');
  });

  it('merges overlapping windows into one zone and lets red win', () => {
    const zones = detectRedZones(
      annotate([
        exam('a', 'c1', '2026-11-02'),
        exam('b', 'c2', '2026-11-02'),
        exam('c', 'c1', '2026-11-03'), // red: a, b, c within 48 hours
        exam('d', 'c3', '2026-11-04'), // orange: c, d — overlaps the red window
        exam('e', 'c1', '2026-11-10'),
        exam('f', 'c2', '2026-11-11'), // a separate orange zone
      ]),
      courses,
      { from: TODAY },
    );
    expect(zones.map((z) => [z.start, z.end, z.severity, z.items.length])).toEqual([
      ['2026-11-02', '2026-11-04', 'red', 4],
      ['2026-11-10', '2026-11-11', 'orange', 2],
    ]);
  });

  it('ignores finished work, deadlines before `from`, and archived courses', () => {
    const items = [
      exam('a', 'c1', '2026-11-02'),
      exam('b', 'c2', '2026-11-02'),
      { ...exam('c', 'c3', '2026-11-02'), status: 'done' as const },
      exam('d', 'c3', '2026-10-26'),
    ];
    expect(detectRedZones(annotate(items), courses, { from: TODAY }).map((z) => z.severity)).toEqual(['orange']);
    const archived = courses.map((c) => (c.id === 'c2' ? { ...c, archived: true } : c));
    expect(detectRedZones(annotate(items), archived, { from: TODAY })).toEqual([]);
  });

  it('honours windowDays and minMajor', () => {
    const spread = annotate([exam('a', 'c1', '2026-11-02'), exam('b', 'c1', '2026-11-03'), exam('c', 'c1', '2026-11-04')]);
    expect(detectRedZones(spread, courses, { from: TODAY })).toEqual([]);
    expect(detectRedZones(spread, courses, { from: TODAY, windowDays: 3 }).map((z) => z.severity)).toEqual(['red']);
    expect(detectRedZones(spread, courses, { from: TODAY, minMajor: 2 }).map((z) => z.severity)).toEqual(['red']);
  });

  it('describes a single-day cluster by its date', () => {
    const zones = detectRedZones(annotate([exam('a', 'c1', '2026-11-02'), exam('b', 'c2', '2026-11-02')]), courses, { from: TODAY });
    expect(zones[0].message).toBe('2 major deadlines on Mon, Nov 2 across PSY 101, HIST 210');
  });
});

describe('stressLevel', () => {
  it('maps scores to calm / busy / heavy / red', () => {
    expect([0, 29, 30, 54, 55, 74, 75, 100].map(stressLevel)).toEqual(['calm', 'calm', 'busy', 'busy', 'heavy', 'heavy', 'red', 'red']);
  });
});

describe('weeklyStress', () => {
  const settings = makeSettings({ daily_capacity_minutes: 120 }); // 7 study days → 14h a week

  function planOf(items: EngineItem[], blocks = [makeBlock()]): PlanResult {
    return { blocks, days: [], overflow: [], annotated: annotate(items) };
  }

  it('blends planned load, deadline points and red zones into a 0–100 score', () => {
    const items = [
      exam('mid', 'c1', '2026-10-30', 'Midterm 1'), // high impact: 3 points
      homework('hw', '2026-10-29'), // 1 point
      makeItem({ id: 'essay', course_id: 'c2', kind: 'paper', title: 'Essay', weight_override: 5, due_date: '2026-10-31' }), // major: 2
    ];
    const blocks = [
      makeBlock({ key: 'b1', date: '2026-10-27', minutes: 300 }),
      makeBlock({ key: 'b2', date: '2026-10-28', minutes: 300 }),
      makeBlock({ key: 'b3', date: '2026-10-29', minutes: 300 }),
      makeBlock({ key: 'b4', date: '2026-10-26', minutes: 200, status: 'done' }),
      makeBlock({ key: 'b5', date: '2026-11-03', minutes: 120 }),
    ];
    const [week1, week2] = weeklyStress(planOf(items, blocks), courses, settings, TODAY, 2);

    // 35 × min(1, 900 / 840) + min(40, 4 × 6) + 12 (orange zone) = 71
    expect(week1).toMatchObject({
      week_start: '2026-10-26',
      week_end: '2026-11-01',
      score: 71,
      level: 'heavy',
      deadlines: 3,
      majorDeadlines: 2,
      plannedMinutes: 900,
      capacityMinutes: 840,
    });
    expect(week1.redZones.map((z) => z.severity)).toEqual(['orange']);
    expect(week1.drivers).toEqual([
      'Planned 15h vs 14h free',
      '2 major deadlines in 48 hours across PSY 101, HIST 210',
      'Midterm 1 (PSY 101)',
    ]);

    // 35 × 120 / 840 = 5, nothing due.
    expect(week2).toMatchObject({ week_start: '2026-11-02', score: 5, level: 'calm', deadlines: 0, drivers: [] });
  });

  it('forces the red level whenever the week has a red zone', () => {
    const items = [exam('a', 'c1', '2026-11-04'), exam('b', 'c2', '2026-11-04'), exam('c', 'c3', '2026-11-05')];
    const [week] = weeklyStress(planOf(items, []), courses, settings, '2026-11-02', 1);
    expect(week.score).toBe(61); // 0 load + 36 deadline points + 25 red zone
    expect(stressLevel(week.score)).toBe('heavy');
    expect(week.level).toBe('red');
    expect(week.drivers[0]).toBe('3 major deadlines in 48 hours across PSY 101, HIST 210, BIO 110');
  });

  it('counts capacity from study days only and caps the deadline points', () => {
    const weekdays = makeSettings({ daily_capacity_minutes: 120, study_days: [1, 2, 3, 4, 5], blackout_dates: ['2026-10-28'] });
    const items = Array.from({ length: 12 }, (_, i) => exam(`e${i}`, 'c1', '2026-10-30'));
    const [week] = weeklyStress(planOf(items, []), courses, weekdays, TODAY, 1);
    expect(week.capacityMinutes).toBe(480);
    expect(week.score).toBe(65); // min(40, 4 × 36) + 25 red zone
  });

  it('returns the requested number of Monday-based weeks', () => {
    const weeks = weeklyStress(planOf([]), courses, settings, '2026-11-01', 3);
    expect(weeks.map((w) => w.week_start)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(weeklyStress(planOf([]), courses, settings, TODAY, 0)).toEqual([]);
  });
});
