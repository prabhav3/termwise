import { describe, expect, it } from 'vitest';

import { courseGrade, requiredScore, type EngineComponent, type EngineCourse, type EngineItem } from '@/engine';

import {
  buildGradeGroups,
  checkWeights,
  defaultHypotheticals,
  defaultTargetItem,
  defaultTargetPercent,
  describeScore,
  draftFor,
  feasibilityOf,
  formatGrade,
  formatNeeded,
  gradedShareLabel,
  openWeightedItems,
  parseDecimal,
  parseScoreDraft,
  rangeOutlook,
  sortedScale,
  targetCutoffs,
} from '../model';

const course: EngineCourse = {
  id: 'c1',
  title: 'Intro to Psychology',
  code: 'PSY 101',
  color: '#4D96FF',
  credits: 3,
  meeting_days: [],
  start_date: null,
  end_date: null,
  target_percent: null,
  grade_scale: [],
  policies: {},
};

function component(overrides: Partial<EngineComponent>): EngineComponent {
  return { id: 'exams', course_id: 'c1', name: 'Exams', weight: 50, expected_count: null, drop_lowest: 0, ...overrides };
}

function item(overrides: Partial<EngineItem>): EngineItem {
  return {
    id: 'i1',
    course_id: 'c1',
    component_id: null,
    title: 'Item',
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

const components = [
  component({ id: 'exams', name: 'Exams', weight: 50, expected_count: 2 }),
  component({ id: 'hw', name: 'Homework', weight: 30, drop_lowest: 1, expected_count: 5 }),
  component({ id: 'part', name: 'Participation', weight: 20 }),
];
const items = [
  item({ id: 'mid', title: 'Midterm', kind: 'exam', component_id: 'exams', score: 80, points_possible: 100, due_date: '2026-10-10' }),
  item({ id: 'final', title: 'Final Exam', kind: 'exam', component_id: 'exams', points_possible: 100, due_date: '2026-12-12' }),
  item({ id: 'hw1', title: 'HW 1', component_id: 'hw', score: 10, points_possible: 10, due_date: '2026-09-10' }),
  item({ id: 'hw2', title: 'HW 2', component_id: 'hw', score: 5, points_possible: 10, due_date: '2026-09-17' }),
  item({ id: 'hw3', title: 'HW 3', component_id: 'hw', score: 9, points_possible: 10, due_date: '2026-09-24' }),
  item({ id: 'hw4', title: 'HW 4', component_id: 'hw', points_possible: 10, due_date: '2026-11-01' }),
  item({ id: 'paper', title: 'Response paper', kind: 'paper', weight_override: 0, due_date: '2026-11-20' }),
  item({ id: 'ch4', title: 'Read ch. 4', kind: 'reading', due_date: '2026-10-01' }),
  item({ id: 'lab', title: 'Lab 1', kind: 'lab', due_date: '2026-10-02' }),
];

describe('scale & formatting', () => {
  it('sorts the scale high to low and falls back to the default', () => {
    expect(sortedScale(course)[0]).toEqual({ letter: 'A', min: 93 });
    const custom = { grade_scale: [{ letter: 'P', min: 50 }, { letter: 'F', min: 0 }, { letter: 'H', min: 85 }] };
    expect(sortedScale(custom).map((c) => c.letter)).toEqual(['H', 'P', 'F']);
    expect(targetCutoffs(custom).map((c) => c.letter)).toEqual(['H', 'P']);
  });

  it('rounds grades down and needed scores up', () => {
    expect(formatGrade(92.96)).toBe('92.9%');
    expect(formatGrade(85)).toBe('85%');
    expect(formatGrade(null)).toBe('—');
    expect(formatNeeded(78.41)).toBe('78.5%');
    expect(formatNeeded(78.4)).toBe('78.4%');
  });

  it('describes scores with points, as a percent, and as extra credit', () => {
    expect(describeScore({ score: 18, points_possible: 20 }).text).toBe('18 / 20 · 90%');
    expect(describeScore({ score: 88.5, points_possible: null }).text).toBe('88.5%');
    expect(describeScore({ score: 2, points_possible: 0 }).text).toBe('+2 extra credit');
    expect(describeScore({ score: null, points_possible: 20 }).text).toBeNull();
  });
});

describe('weights', () => {
  it('flags weights that do not add up to 100', () => {
    expect(checkWeights({ totalWeight: 100 })).toEqual({ kind: 'ok', total: 100 });
    expect(checkWeights({ totalWeight: 99.7 }).kind).toBe('ok');
    expect(checkWeights({ totalWeight: 85 })).toEqual({ kind: 'under', total: 85 });
    expect(checkWeights({ totalWeight: 110 })).toEqual({ kind: 'over', total: 110 });
    expect(checkWeights({ totalWeight: 0 })).toEqual({ kind: 'none' });
  });

  it('says how much of the grade is in', () => {
    expect(gradedShareLabel({ gradedWeight: 62, totalWeight: 100 })).toBe('62% of the grade is in');
    expect(gradedShareLabel({ gradedWeight: 0, totalWeight: 100 })).toBe('No scores in yet');
    expect(gradedShareLabel({ gradedWeight: 0, totalWeight: 0 })).toBe('No grading weights yet');
  });
});

describe('buildGradeGroups', () => {
  const grade = courseGrade(course, components, items);
  const groups = buildGradeGroups('c1', components, items, grade);

  it('keeps categories in order, adds self-weighted items, and collects uncounted ones', () => {
    expect(groups.map((g) => [g.key, g.kind])).toEqual([
      ['exams', 'component'],
      ['hw', 'component'],
      ['part', 'component'],
      ['item:paper', 'standalone'],
      ['uncounted', 'uncounted'],
    ]);
    // Plain readings are not gradeable work; the unlinked lab is.
    expect(groups[4].items.map((i) => i.id)).toEqual(['lab']);
  });

  it('reports percents, drops and missing items', () => {
    const hw = groups[1];
    expect(hw.percent).toBe(95);
    expect([...hw.droppedIds]).toEqual(['hw2']);
    expect(hw.missing).toBe(1);
    expect(hw.items.map((i) => i.id)).toEqual(['hw1', 'hw2', 'hw3', 'hw4']);
    expect(groups[0].missing).toBe(0);
  });
});

describe('what do I need?', () => {
  it('lists open weighted items and picks the final exam by default', () => {
    const open = openWeightedItems('c1', components, items);
    expect(open.map((i) => i.id)).toEqual(['hw4', 'final']); // the 0%-weighted paper can't move the grade
    expect(defaultTargetItem(open)?.id).toBe('final');
  });

  it('falls back to the last major item, then the last item', () => {
    const project = item({ id: 'proj', kind: 'project', due_date: '2026-11-01' });
    const quiz = item({ id: 'quiz', kind: 'quiz', due_date: '2026-12-01' });
    expect(defaultTargetItem([project, quiz])?.id).toBe('proj');
    expect(defaultTargetItem([quiz])?.id).toBe('quiz');
    expect(defaultTargetItem([])).toBeNull();
  });

  it('defaults the target to the course target, else the letter you hold', () => {
    expect(defaultTargetPercent({ ...course, target_percent: 90 }, { percent: 70 })).toBe(90);
    expect(defaultTargetPercent(course, { percent: 88.2 })).toBe(87); // B+
    expect(defaultTargetPercent(course, { percent: 40 })).toBe(80); // F is never a target
    expect(defaultTargetPercent(course, { percent: null })).toBe(80);
  });

  it('grades feasibility from the engine result', () => {
    const result = requiredScore(course, components, items, 'final', 85);
    expect(result.neededPercent).not.toBeNull();
    expect(feasibilityOf({ alreadySecured: true, achievable: true, neededPercent: 0 })).toBe('secured');
    expect(feasibilityOf({ alreadySecured: false, achievable: true, neededPercent: 72 })).toBe('within_reach');
    expect(feasibilityOf({ alreadySecured: false, achievable: true, neededPercent: 94 })).toBe('stretch');
    expect(feasibilityOf({ alreadySecured: false, achievable: false, neededPercent: 112 })).toBe('out_of_reach');
    expect(feasibilityOf({ alreadySecured: false, achievable: false, neededPercent: null })).toBe('unknown');
  });

  it('places the target against the projected range', () => {
    expect(rangeOutlook(91, 98, 90)).toBe('secured');
    expect(rangeOutlook(60, 95, 90)).toBe('possible');
    expect(rangeOutlook(60, 85, 90)).toBe('out_of_reach');
    expect(rangeOutlook(null, 85, 90)).toBeNull();
  });
});

describe('scenario defaults', () => {
  it('starts each slider at its category average, else the course average', () => {
    const grade = courseGrade(course, components, items);
    const open = openWeightedItems('c1', components, items);
    expect(defaultHypotheticals(open, grade, course)).toEqual({ hw4: 95, final: 80 });
    const solo = item({ id: 'solo', weight_override: 10 });
    expect(defaultHypotheticals([solo], { percent: null, components: [] }, { target_percent: 88 })).toEqual({ solo: 88 });
  });
});

describe('score entry', () => {
  it('parses decimals leniently', () => {
    expect(parseDecimal(' 18,5 ')).toBe(18.5);
    expect(parseDecimal('90%')).toBe(90);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('')).toBeNull();
    expect(Number.isNaN(parseDecimal('abc'))).toBe(true);
    expect(Number.isNaN(parseDecimal('-3'))).toBe(true);
  });

  it('saves points entries, including "18/20" typed in one box', () => {
    const target = { points_possible: 20 };
    expect(parseScoreDraft({ mode: 'points', score: '18', points: '20', percent: '' }, target)).toEqual({
      ok: true,
      score: 18,
      pointsPossible: 20,
    });
    expect(parseScoreDraft({ mode: 'points', score: '45/50', points: '', percent: '' }, target)).toEqual({
      ok: true,
      score: 45,
      pointsPossible: 50,
    });
    expect(parseScoreDraft({ mode: 'points', score: '', points: '20', percent: '' }, target)).toMatchObject({ ok: false, field: 'score' });
    expect(parseScoreDraft({ mode: 'points', score: '18', points: '0', percent: '' }, target)).toMatchObject({ ok: false, field: 'points' });
    expect(parseScoreDraft({ mode: 'points', score: '90', points: '20', percent: '' }, target)).toMatchObject({ ok: false, field: 'score' });
  });

  it('keeps an item’s points when a percent is typed', () => {
    expect(parseScoreDraft({ mode: 'percent', score: '', points: '', percent: '90' }, { points_possible: 20 })).toEqual({
      ok: true,
      score: 18,
      pointsPossible: 20,
    });
    expect(parseScoreDraft({ mode: 'percent', score: '', points: '', percent: '87.5' }, { points_possible: null })).toEqual({
      ok: true,
      score: 87.5,
      pointsPossible: null,
    });
    expect(parseScoreDraft({ mode: 'percent', score: '', points: '', percent: '' }, { points_possible: null })).toMatchObject({ ok: false });
  });

  it('prefills the editor from the saved score', () => {
    expect(draftFor({ score: 18, points_possible: 20 })).toEqual({ mode: 'points', score: '18', points: '20', percent: '90' });
    expect(draftFor({ score: null, points_possible: null })).toEqual({ mode: 'percent', score: '', points: '', percent: '' });
  });
});
