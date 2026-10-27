import { describe, expect, it } from 'vitest';
import { annotateItems, focusLabel, focusQueue, pomodoroCycles } from '../index';
import type { PlanResult } from '../types';
import { makeBlock, makeCourse, makeInput, makeItem, TODAY } from './fixtures';

describe('focusLabel', () => {
  it('reads "Study N mins for <course code> <title>"', () => {
    expect(focusLabel({ title: 'Quiz 1' }, { code: 'PSY 101', title: 'Intro to Psychology' }, 25)).toBe('Study 25 mins for PSY 101 Quiz 1');
    expect(focusLabel({ title: 'Quiz 1' }, { code: null, title: 'Intro to Psychology' }, 40)).toBe('Study 40 mins for Intro to Psychology Quiz 1');
    expect(focusLabel({ title: 'Quiz 1' }, undefined, 1)).toBe('Study 1 min for Quiz 1');
  });
});

describe('focusQueue', () => {
  const courses = [makeCourse()];
  const items = [
    makeItem({ id: 'hw', title: 'Problem Set 4', due_date: '2026-11-01' }),
    makeItem({ id: 'mid', kind: 'exam', title: 'Midterm 1', weight_override: 30, due_date: '2026-10-29' }),
  ];
  const plan: PlanResult = {
    days: [],
    overflow: [],
    annotated: annotateItems(makeInput({ items })),
    blocks: [
      makeBlock({ key: 'hw:work:1', item_id: 'hw', minutes: 20, sort_order: 0 }),
      makeBlock({ key: 'mid:study:1', item_id: 'mid', kind: 'study', minutes: 90, sort_order: 1 }),
      makeBlock({ key: 'hw:work:0', item_id: 'hw', minutes: 30, status: 'done' }),
      makeBlock({ key: 'mid:study:2', item_id: 'mid', kind: 'study', minutes: 90, date: '2026-10-28' }),
    ],
  };

  it("orders the day's planned blocks by triage priority and caps each at one focus session", () => {
    expect(focusQueue(plan, courses, TODAY, 25)).toEqual([
      { block_key: 'mid:study:1', item_id: 'mid', course_id: 'c1', label: 'Study 25 mins for PSY 101 Midterm 1', minutes: 25 },
      { block_key: 'hw:work:1', item_id: 'hw', course_id: 'c1', label: 'Study 20 mins for PSY 101 Problem Set 4', minutes: 20 },
    ]);
  });

  it('keeps full block length when no focus length is set', () => {
    expect(focusQueue(plan, courses, TODAY, 0).map((t) => t.minutes)).toEqual([90, 20]);
  });
});

describe('pomodoroCycles', () => {
  const f = (minutes: number) => ({ kind: 'focus', minutes });
  const s = (minutes: number) => ({ kind: 'short_break', minutes });
  const l = (minutes: number) => ({ kind: 'long_break', minutes });

  it('alternates 25-minute focus with 5-minute breaks and never ends on a break', () => {
    expect(pomodoroCycles(100)).toEqual([f(25), s(5), f(25), s(5), f(25), s(5), f(25)]);
  });

  it('takes a long break after every fourth focus and shortens the last one', () => {
    expect(pomodoroCycles(110)).toEqual([f(25), s(5), f(25), s(5), f(25), s(5), f(25), l(15), f(10)]);
  });

  it('accepts custom lengths', () => {
    expect(pomodoroCycles(60, 20, 10, 30, 2)).toEqual([f(20), s(10), f(20), l(30), f(20)]);
    expect(pomodoroCycles(45, 50)).toEqual([f(45)]);
  });

  it('returns nothing for no time', () => {
    expect(pomodoroCycles(0)).toEqual([]);
    expect(pomodoroCycles(-10)).toEqual([]);
  });
});
