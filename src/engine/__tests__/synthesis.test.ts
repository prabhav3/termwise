import { describe, expect, it } from 'vitest';
import { annotateItems, mergeTermEvents, synthesizeMasterCalendar } from '../index';
import type { EngineCourse, EngineItem } from '../types';
import { makeCourse, makeInput, makeItem, makeTermEvent } from './fixtures';

describe('mergeTermEvents', () => {
  it('collapses the same break listed by several syllabi into one event', () => {
    const merged = mergeTermEvents([
      makeTermEvent({ id: 'a', course_id: 'c1', title: 'Thanksgiving Break', start_date: '2026-11-25', end_date: '2026-11-27' }),
      makeTermEvent({ id: 'b', course_id: 'c2', title: 'thanksgiving break!', start_date: '2026-11-26', end_date: '2026-11-29' }),
      makeTermEvent({ id: 'c', course_id: 'c3', title: 'Thanksgiving', start_date: '2026-11-25', end_date: '2026-11-25' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start_date: '2026-11-25', end_date: '2026-11-29', course_id: null, kind: 'break' });
    expect(merged[0].title.toLowerCase()).toContain('thanksgiving');
  });

  it('merges adjacent ranges and chains, keeping the course when all copies share it', () => {
    const merged = mergeTermEvents([
      makeTermEvent({ id: 'a', title: 'Fall Break', start_date: '2026-10-12', end_date: '2026-10-13' }),
      makeTermEvent({ id: 'b', title: 'Fall Break', start_date: '2026-10-14', end_date: '2026-10-14' }),
      makeTermEvent({ id: 'c', title: 'Fall break', start_date: '2026-10-15', end_date: '2026-10-16' }),
    ]);
    expect(merged).toEqual([expect.objectContaining({ id: 'a', start_date: '2026-10-12', end_date: '2026-10-16', course_id: 'c1' })]);
  });

  it('keeps different kinds, distant dates and different titles apart', () => {
    const merged = mergeTermEvents([
      makeTermEvent({ id: 'h', kind: 'holiday', title: 'Veterans Day', start_date: '2026-11-11', end_date: '2026-11-11' }),
      makeTermEvent({ id: 'n', kind: 'no_class', title: 'Veterans Day', start_date: '2026-11-11', end_date: '2026-11-11' }),
      makeTermEvent({ id: 'r1', kind: 'other', title: 'Reading Day', start_date: '2026-12-07', end_date: '2026-12-07' }),
      makeTermEvent({ id: 'r2', kind: 'other', title: 'Reading Day', start_date: '2026-12-10', end_date: '2026-12-10' }),
      makeTermEvent({ id: 'e', kind: 'holiday', title: 'Election Day', start_date: '2026-11-11', end_date: '2026-11-11' }),
    ]);
    expect(merged.map((e) => e.id)).toEqual(['e', 'h', 'n', 'r1', 'r2']);
  });

  it('repairs reversed ranges and drops malformed dates', () => {
    const merged = mergeTermEvents([
      makeTermEvent({ id: 'a', start_date: '2026-11-27', end_date: '2026-11-25' }),
      makeTermEvent({ id: 'bad', start_date: 'Nov 25', end_date: '2026-11-27' }),
    ]);
    expect(merged).toEqual([expect.objectContaining({ id: 'a', start_date: '2026-11-25', end_date: '2026-11-27' })]);
  });
});

describe('synthesizeMasterCalendar', () => {
  const courses: EngineCourse[] = [
    makeCourse({ id: 'c1', code: 'PSY 101' }),
    makeCourse({ id: 'c2', code: 'HIST 210', title: 'Modern Europe' }),
    makeCourse({ id: 'c3', code: 'ART 100', title: 'Drawing', archived: true }),
  ];
  const items: EngineItem[] = [
    makeItem({ id: 'mid', course_id: 'c1', kind: 'exam', title: 'Midterm 2', due_date: '2026-11-02' }),
    makeItem({ id: 'essay', course_id: 'c2', kind: 'paper', title: 'Essay 2', due_date: '2026-11-02' }),
    makeItem({ id: 'turkey', course_id: 'c1', title: 'Problem Set 9', due_date: '2026-11-26' }),
    makeItem({ id: 'late', course_id: 'c1', title: 'Late Lab', due_date: '2026-12-20' }),
    makeItem({ id: 'early', course_id: 'c2', title: 'Map Quiz', kind: 'quiz', due_date: '2026-08-20' }),
    makeItem({ id: 'tbd1', course_id: 'c1', kind: 'reading', title: 'Article B', due_date: null }),
    makeItem({ id: 'tbd2', course_id: 'c2', kind: 'reading', title: 'Article A', due_date: null }),
    makeItem({ id: 'doneOnBreak', course_id: 'c2', title: 'Old Work', due_date: '2026-11-25', status: 'done' }),
    makeItem({ id: 'art', course_id: 'c3', kind: 'project', title: 'Portfolio', due_date: '2026-11-02' }),
  ];
  const termEvents = [
    makeTermEvent({ id: 't1', course_id: 'c1', start_date: '2026-11-25', end_date: '2026-11-27' }),
    makeTermEvent({ id: 't2', course_id: 'c2', title: 'Thanksgiving break', start_date: '2026-11-25', end_date: '2026-11-29' }),
    makeTermEvent({ id: 't3', course_id: 'c3', title: 'Studio closed', kind: 'no_class', start_date: '2026-10-01', end_date: '2026-10-01' }),
  ];
  const calendar = synthesizeMasterCalendar(courses, annotateItems(makeInput({ courses, items })), termEvents);

  it('lists every dated item from active courses plus deduped term events, sorted', () => {
    expect(calendar.events.map((e) => [e.date, e.type, e.id])).toEqual([
      ['2026-08-20', 'item', 'early'],
      ['2026-11-02', 'item', 'essay'],
      ['2026-11-02', 'item', 'mid'],
      ['2026-11-25', 'term_event', 't1'],
      ['2026-11-25', 'item', 'doneOnBreak'],
      ['2026-11-26', 'item', 'turkey'],
      ['2026-12-20', 'item', 'late'],
    ]);
    expect(calendar.termEvents).toEqual([expect.objectContaining({ start_date: '2026-11-25', end_date: '2026-11-29', course_id: null })]);
    expect(calendar.events.find((e) => e.id === 'mid')).toMatchObject({ isHighImpact: true, kind: 'exam', end_date: '2026-11-02' });
    expect(calendar.start).toBe('2026-08-20');
    expect(calendar.end).toBe('2026-12-20');
  });

  it('flags same-day majors, deadlines on breaks, dates outside the course, and undated items', () => {
    expect(calendar.conflicts.map((c) => [c.kind, c.date, c.item_ids])).toEqual([
      ['outside_course_dates', '2026-08-20', ['early']],
      ['same_day_majors', '2026-11-02', ['essay', 'mid']],
      ['due_on_holiday', '2026-11-26', ['turkey']],
      ['outside_course_dates', '2026-12-20', ['late']],
      ['unscheduled', null, ['tbd2', 'tbd1']],
    ]);
    const messages = Object.fromEntries(calendar.conflicts.map((c) => [c.kind + (c.date ?? ''), c.message]));
    expect(messages['same_day_majors2026-11-02']).toBe('2 major deadlines on Mon, Nov 2: HIST 210 Essay 2, PSY 101 Midterm 2');
    expect(messages['due_on_holiday2026-11-26']).toMatch(/^PSY 101 Problem Set 9 is due during Thanksgiving/);
    expect(messages['outside_course_dates2026-12-20']).toBe('PSY 101 Late Lab is due Dec 20, after PSY 101 ends (Dec 18).');
    expect(messages.unscheduled).toBe('2 items have no due date yet: HIST 210 Article A, PSY 101 Article B');
  });

  it('does not flag two majors from the same course', () => {
    const same = [
      makeItem({ id: 'a', kind: 'exam', title: 'Exam A', due_date: '2026-11-02' }),
      makeItem({ id: 'b', kind: 'paper', title: 'Paper B', due_date: '2026-11-02' }),
    ];
    const result = synthesizeMasterCalendar([makeCourse()], annotateItems(makeInput({ items: same })), []);
    expect(result.conflicts).toEqual([]);
  });
});
