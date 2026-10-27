import { describe, expect, it } from 'vitest';
import { computeImpact, effectiveWeight, isMajorKind } from '../index';
import type { EngineComponent, EngineCourse, EngineItem } from '../types';
import { makeComponent, makeCourse, makeItem, makeSettings } from './fixtures';

function impactOf(item: EngineItem, opts: { components?: EngineComponent[]; items?: EngineItem[]; course?: EngineCourse; threshold?: number } = {}) {
  return computeImpact(item, {
    course: opts.course ?? makeCourse(),
    components: opts.components ?? [],
    items: opts.items ?? [item],
    settings: makeSettings({ high_impact_threshold: opts.threshold ?? 15 }),
  });
}

describe('isMajorKind', () => {
  it('flags exams, papers, projects and presentations only', () => {
    expect(['exam', 'paper', 'project', 'presentation'].every((k) => isMajorKind(k as EngineItem['kind']))).toBe(true);
    expect(['quiz', 'homework', 'reading', 'lab', 'discussion', 'other'].some((k) => isMajorKind(k as EngineItem['kind']))).toBe(false);
  });
});

describe('effectiveWeight', () => {
  const quizzes = makeComponent({ id: 'quizzes', name: 'Quizzes', weight: 20 });

  it('uses weight_override first, even when linked to a component', () => {
    const item = makeItem({ component_id: 'quizzes', weight_override: 12 });
    expect(effectiveWeight(item, [quizzes], [item])).toBe(12);
  });

  it('splits a component by max(expected_count, linked items)', () => {
    const a = makeItem({ id: 'a', component_id: 'quizzes' });
    const b = makeItem({ id: 'b', component_id: 'quizzes' });
    expect(effectiveWeight(a, [{ ...quizzes, expected_count: 10 }], [a, b])).toBe(2);
    expect(effectiveWeight(a, [{ ...quizzes, expected_count: 1 }], [a, b])).toBe(10);
    expect(effectiveWeight(a, [{ ...quizzes, expected_count: null }], [a, b])).toBe(10);
  });

  it('reduces N by drop_lowest only while N stays at least 1', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => makeItem({ id, component_id: 'quizzes' }));
    expect(effectiveWeight(items[0], [{ ...quizzes, drop_lowest: 1 }], items)).toBe(5);
    const single = makeItem({ id: 'solo', component_id: 'quizzes' });
    expect(effectiveWeight(single, [{ ...quizzes, drop_lowest: 1 }], [single])).toBe(20);
  });

  it('is null without a component, or with a component it cannot find', () => {
    expect(effectiveWeight(makeItem(), [quizzes], [])).toBeNull();
    expect(effectiveWeight(makeItem({ component_id: 'missing' }), [quizzes], [])).toBeNull();
  });
});

describe('computeImpact', () => {
  it('scores 25% of the grade at about 60 points plus the kind bonus, with plain reasons', () => {
    const midterm = makeItem({ title: 'Midterm 1', kind: 'exam', weight_override: 25 });
    const impact = impactOf(midterm);
    expect(impact.weight).toBe(25);
    expect(impact.score).toBe(75);
    expect(impact.isHighImpact).toBe(true);
    expect(impact.reasons).toEqual(['Worth 25% of PSY 101', 'Midterm exam']);
    expect(impactOf(makeItem({ title: 'Final Exam', kind: 'exam', weight_override: 30 })).reasons).toContain('Final exam');
  });

  it('applies the high-impact rules in order', () => {
    // weight >= threshold
    expect(impactOf(makeItem({ kind: 'homework', weight_override: 15 })).isHighImpact).toBe(true);
    expect(impactOf(makeItem({ kind: 'homework', weight_override: 14.9 })).isHighImpact).toBe(false);
    // exam/paper/project at >= threshold / 2
    expect(impactOf(makeItem({ kind: 'paper', weight_override: 7.5 })).isHighImpact).toBe(true);
    expect(impactOf(makeItem({ kind: 'quiz', weight_override: 7.5 })).isHighImpact).toBe(false);
    expect(impactOf(makeItem({ kind: 'paper', weight_override: 7.4 })).isHighImpact).toBe(false);
    // major with unknown weight
    expect(impactOf(makeItem({ kind: 'homework', is_major: true })).isHighImpact).toBe(true);
    expect(impactOf(makeItem({ kind: 'homework' })).isHighImpact).toBe(false);
    // override beats everything
    expect(impactOf(makeItem({ kind: 'exam', weight_override: 40, high_impact_override: false })).isHighImpact).toBe(false);
    expect(impactOf(makeItem({ kind: 'reading', high_impact_override: true })).isHighImpact).toBe(true);
    // threshold is a setting
    expect(impactOf(makeItem({ kind: 'homework', weight_override: 10 }), { threshold: 10 }).isHighImpact).toBe(true);
  });

  it('lets grade weight dominate the score', () => {
    const scores = [2, 5, 10, 20, 30].map((w) => impactOf(makeItem({ kind: 'homework', weight_override: w })).score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(impactOf(makeItem({ kind: 'homework', weight_override: 30 })).score).toBeGreaterThan(
      impactOf(makeItem({ kind: 'exam', weight_override: 5 })).score,
    );
  });

  it('scales by course credits within 0.67–1.5', () => {
    const exam = makeItem({ kind: 'exam', weight_override: 10 });
    const base = impactOf(exam).score; // (24 + 15) × 1 = 39
    expect(base).toBe(39);
    expect(impactOf(exam, { course: makeCourse({ credits: 4 }) }).score).toBe(52);
    expect(impactOf(exam, { course: makeCourse({ credits: 9 }) }).score).toBe(59); // capped at ×1.5
    expect(impactOf(exam, { course: makeCourse({ credits: 1 }) }).score).toBe(26); // floored at ×0.67
    expect(impactOf(exam, { course: makeCourse({ credits: 4 }) }).reasons).toContain('4-credit course');
  });

  it('honours manual overrides in the score', () => {
    const reading = impactOf(makeItem({ kind: 'reading', high_impact_override: true }));
    expect(reading.score).toBeGreaterThanOrEqual(60);
    expect(reading.reasons).toContain('Marked high impact');
    const exam = impactOf(makeItem({ kind: 'exam', weight_override: 40, high_impact_override: false }));
    expect(exam.score).toBeLessThanOrEqual(30);
    expect(exam.reasons).toContain('Marked low impact');
  });

  it('stays within 0–100', () => {
    expect(impactOf(makeItem({ kind: 'exam', weight_override: 100 }), { course: makeCourse({ credits: 6 }) }).score).toBe(100);
    expect(impactOf(makeItem({ kind: 'homework', weight_override: 0 })).score).toBe(0);
  });
});
