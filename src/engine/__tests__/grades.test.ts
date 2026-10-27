import { describe, expect, it } from 'vitest';
import { courseGrade, DEFAULT_GRADE_SCALE, itemPercent, letterFor, requiredScore, simulateGrade } from '../index';
import type { EngineItem } from '../types';
import { makeComponent, makeCourse, makeItem } from './fixtures';

const course = makeCourse();
const graded = (id: string, component_id: string | null, score: number | null, points: number | null, overrides: Partial<EngineItem> = {}) =>
  makeItem({ id, title: id, component_id, score, points_possible: points, ...overrides });

describe('itemPercent', () => {
  it('is score ÷ points, the raw score without points, and null when ungraded', () => {
    expect(itemPercent({ score: 45, points_possible: 50 })).toBe(90);
    expect(itemPercent({ score: 88, points_possible: null })).toBe(88);
    expect(itemPercent({ score: null, points_possible: 10 })).toBeNull();
    expect(itemPercent({ score: 2, points_possible: 0 })).toBeNull(); // extra credit has no percent of its own
  });
});

describe('letterFor', () => {
  it('uses the highest cutoff reached', () => {
    expect(letterFor(93, DEFAULT_GRADE_SCALE)).toBe('A');
    expect(letterFor(92.99, DEFAULT_GRADE_SCALE)).toBe('A-');
    expect(letterFor(85.625, DEFAULT_GRADE_SCALE)).toBe('B');
    expect(letterFor(12, DEFAULT_GRADE_SCALE)).toBe('F');
    expect(letterFor(null, DEFAULT_GRADE_SCALE)).toBeNull();
    expect(letterFor(75, [])).toBe('C'); // empty scale → default
    expect(letterFor(51, [{ letter: 'F', min: 0 }, { letter: 'P', min: 50 }])).toBe('P');
  });
});

describe('courseGrade', () => {
  const components = [
    makeComponent({ id: 'exams', name: 'Exams', weight: 50, expected_count: 2 }),
    makeComponent({ id: 'hw', name: 'Homework', weight: 30, drop_lowest: 1 }),
    makeComponent({ id: 'part', name: 'Participation', weight: 20 }),
  ];
  const items = [
    graded('mid', 'exams', 80, 100),
    graded('final', 'exams', null, 100),
    graded('hw1', 'hw', 10, 10),
    graded('hw2', 'hw', 5, 10),
    graded('hw3', 'hw', 9, 10),
    graded('hw4', 'hw', null, 10),
  ];

  it('weights graded components, drops the lowest homework, and projects the range', () => {
    const grade = courseGrade(course, components, items);
    expect(grade.components).toEqual([
      { component_id: 'exams', name: 'Exams', weight: 50, percent: 80, gradedCount: 1, totalCount: 2, droppedItemIds: [] },
      { component_id: 'hw', name: 'Homework', weight: 30, percent: 95, gradedCount: 3, totalCount: 4, droppedItemIds: ['hw2'] },
      { component_id: 'part', name: 'Participation', weight: 20, percent: null, gradedCount: 0, totalCount: 0, droppedItemIds: [] },
    ]);
    expect(grade.percent).toBeCloseTo(85.625, 10); // (50 × 80 + 30 × 95) ÷ 80
    expect(grade.letter).toBe('B');
    expect(grade.gradedWeight).toBe(80);
    expect(grade.totalWeight).toBe(100);
    expect(grade.projectedMin).toBeCloseTo(44, 10); // final 0, hw4 0 (dropped), participation 0
    expect(grade.projectedMax).toBeCloseTo(94, 10); // final 100, hw4 10/10, participation 100
  });

  it('drops only while more than drop_lowest items are graded', () => {
    const grade = courseGrade(course, components, [graded('hw1', 'hw', 5, 10), graded('hw2', 'hw', null, 10)]);
    expect(grade.components[1]).toMatchObject({ percent: 50, droppedItemIds: [] });
  });

  it('averages item percents when some graded item has no points', () => {
    const quizzes = [makeComponent({ id: 'q', weight: 100 })];
    const grade = courseGrade(course, quizzes, [graded('q1', 'q', 8, 10), graded('q2', 'q', 90, null)]);
    expect(grade.percent).toBe(85);
  });

  it('treats a weighted item without a component as its own component', () => {
    const grade = courseGrade(course, components, [
      graded('mid', 'exams', 80, 100),
      graded('proj', null, 45, 50, { title: 'Final Project', weight_override: 20 }),
    ]);
    expect(grade.components.find((c) => c.component_id === 'proj')).toMatchObject({ name: 'Final Project', weight: 20, percent: 90 });
    expect(grade.percent).toBeCloseTo((50 * 80 + 20 * 90) / 70, 10);
    expect(grade.totalWeight).toBe(120);
  });

  it('falls back to plain points when a course has no weights, with no projection', () => {
    const grade = courseGrade(course, [], [graded('a', null, 8, 10), graded('b', null, 18, 20), graded('c', null, null, 10)]);
    expect(grade.percent).toBeCloseTo(86.667, 3);
    expect(grade.letter).toBe('B');
    expect(grade.projectedMin).toBeNull();
    expect(grade.projectedMax).toBeNull();
  });

  it('uses the course grade scale when it has one and is null when nothing is graded', () => {
    const passFail = makeCourse({ grade_scale: [{ letter: 'P', min: 60 }, { letter: 'F', min: 0 }] });
    expect(courseGrade(passFail, components, items).letter).toBe('P');
    const empty = courseGrade(course, components, [graded('final', 'exams', null, 100)]);
    expect(empty.percent).toBeNull();
    expect(empty.letter).toBeNull();
    expect(empty.projectedMax).toBe(100);
    expect(empty.projectedMin).toBe(0);
  });
});

describe('requiredScore', () => {
  const components = [makeComponent({ id: 'exams', weight: 60, expected_count: 2 }), makeComponent({ id: 'hw', name: 'Homework', weight: 40 })];
  const base = [
    graded('mid', 'exams', 70, 100),
    graded('final', 'exams', null, 100, { title: 'Final Exam' }),
    graded('hw1', 'hw', 9, 10),
    graded('hw2', 'hw', 9, 10),
  ];

  it('solves for the score needed on the item', () => {
    // 0.6 × (70 + x) / 2 + 0.4 × 90 ≥ 80  →  x ≥ 76.67
    expect(requiredScore(course, components, base, 'final', 80)).toEqual({
      item_id: 'final',
      targetPercent: 80,
      neededPercent: 76.7,
      achievable: true,
      alreadySecured: false,
      explanation: 'You need at least 76.7% on Final Exam to finish with 80% (B-).',
    });
  });

  it('reports a target that is already secured', () => {
    const result = requiredScore(course, components, base, 'final', 55);
    expect(result).toMatchObject({ neededPercent: 0, achievable: true, alreadySecured: true });
    expect(result.explanation).toMatch(/^You've already secured 55%/);
  });

  it('still reports the number when more than full marks are needed', () => {
    const result = requiredScore(course, components, base, 'final', 95);
    expect(result).toMatchObject({ neededPercent: 126.7, achievable: false, alreadySecured: false });
    expect(result.explanation).toBe(
      "You'd need 126.7% on Final Exam to reach 95% (A), which is more than full marks — a perfect score gets you about 87%.",
    );
  });

  it('assumes other ungraded work at the current average, zero, or full marks', () => {
    const items = [...base, graded('hw3', 'hw', null, 10)];
    const average = requiredScore(course, components, items, 'final', 80);
    expect(average.neededPercent).toBe(76.7);
    expect(average.explanation).toContain('assuming you keep your current average on everything else');
    expect(requiredScore(course, components, items, 'final', 80, 'zero')).toMatchObject({ neededPercent: 116.7, achievable: false });
    expect(requiredScore(course, components, items, 'final', 80, 'perfect')).toMatchObject({ neededPercent: 72.3, achievable: true });
  });

  it('accounts for drop-lowest when the target score could be dropped', () => {
    const quizzes = [makeComponent({ id: 'q', weight: 100, drop_lowest: 1 })];
    const items = [graded('q1', 'q', 5, 10), graded('q2', 'q', 9, 10), graded('q3', 'q', null, 10, { title: 'Quiz 3' })];
    // Below 50% the quiz itself is dropped (70% overall); above it, q1 is dropped: (9 + x/10) / 20 ≥ 0.8.
    expect(requiredScore(course, quizzes, items, 'q3', 80)).toMatchObject({ neededPercent: 70, achievable: true });
    expect(requiredScore(course, quizzes, items, 'q3', 65)).toMatchObject({ neededPercent: 0, alreadySecured: true });
  });

  it('explains when it cannot answer', () => {
    expect(requiredScore(course, components, base, 'missing', 80)).toMatchObject({
      neededPercent: null,
      achievable: false,
      explanation: "Couldn't find that assignment in this course.",
    });
    expect(requiredScore(course, [], [graded('a', null, null, 10)], 'a', 80).explanation).toBe(
      'Add grading weights for this course to see what you need.',
    );
    const loose = [...base, graded('extra', null, null, 10, { title: 'Bonus Worksheet' })];
    expect(requiredScore(course, components, loose, 'extra', 80).explanation).toMatch(/^Bonus Worksheet isn't linked to a weighted grade category/);
  });

  it('ignores the target item’s own existing score', () => {
    const scored = base.map((i) => (i.id === 'final' ? { ...i, score: 20 } : i));
    expect(requiredScore(course, components, scored, 'final', 80).neededPercent).toBe(76.7);
  });
});

describe('simulateGrade', () => {
  const components = [makeComponent({ id: 'exams', weight: 50, expected_count: 2 }), makeComponent({ id: 'hw', weight: 30 })];
  const items = [graded('mid', 'exams', 80, 100), graded('final', 'exams', null, 100), graded('hw1', 'hw', 19, 20)];

  it('applies hypothetical percents and recomputes the grade', () => {
    const simulated = simulateGrade(course, components, items, { final: 90 });
    const manual = courseGrade(course, components, items.map((i) => (i.id === 'final' ? { ...i, score: 90 } : i)));
    expect(simulated).toEqual(manual);
    expect(simulated.percent).toBeCloseTo((50 * 85 + 30 * 95) / 80, 10);
    expect(simulated.letter).toBe('B+');
  });

  it('converts percents to points and ignores non-finite or unknown entries', () => {
    const halfPoints = [graded('a', 'hw', null, 20)];
    expect(simulateGrade(course, components, halfPoints, { a: 50 }).components[1].percent).toBe(50);
    expect(simulateGrade(course, components, items, { final: Number.NaN, ghost: 100 })).toEqual(courseGrade(course, components, items));
  });
});
