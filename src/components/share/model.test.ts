import { describe, expect, it } from 'vitest';

import type { SharedSnapshot, Term } from '@/types/db';

import { countLabel, courseByline, suggestShareTerm, summarizeSnapshot, type SharedItem } from './model';

function item(partial: Partial<SharedItem> & Pick<SharedItem, 'title' | 'kind'>): SharedItem {
  return {
    description: null,
    assigned_date: null,
    due_date: null,
    due_time: null,
    weight_override: null,
    points_possible: null,
    estimated_minutes: null,
    reading: null,
    pages: null,
    is_major: false,
    component_ref: null,
    ...partial,
  };
}

function snapshot(items: SharedItem[]): SharedSnapshot {
  return {
    version: 1,
    course: {
      title: 'Linear Algebra',
      code: 'MATH 221',
      section: '3',
      instructor: 'Dr. Okafor',
      credits: 4,
      color: '#4D96FF',
      meeting_days: [1, 3],
      meeting_start: '10:00',
      meeting_end: '10:50',
      location: null,
      start_date: '2026-08-31',
      end_date: '2026-12-11',
      grade_scale: [],
      policies: {},
    },
    components: [],
    textbooks: [{ ref: 't1', title: 'Strang', authors: null, chapters: [] }],
    items,
    term_events: [],
  };
}

function term(partial: Partial<Term> & Pick<Term, 'id' | 'name'>): Term {
  return {
    user_id: 'u',
    start_date: null,
    end_date: null,
    is_active: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const reading = { textbook_id: null, chapters: ['4'], page_ranges: [], explicit_pages: null, description: null };

describe('summarizeSnapshot', () => {
  const items = [
    item({ title: 'Midterm', kind: 'exam', due_date: '2026-10-20' }),
    item({ title: 'Final', kind: 'exam', due_date: '2026-12-10', due_time: '09:00' }),
    item({ title: 'Quiz 3', kind: 'quiz', due_date: '2026-10-29' }),
    item({ title: 'Project', kind: 'project', due_date: '2026-11-15' }),
    item({ title: 'Read ch. 4', kind: 'reading', due_date: '2026-10-28' }),
    item({ title: 'PS 5 + read ch. 5', kind: 'homework', reading, due_date: '2026-10-28', due_time: '08:00' }),
    item({ title: 'PS 6', kind: 'homework' }),
  ];

  it('counts groups in a fixed order and skips empty ones', () => {
    const summary = summarizeSnapshot(snapshot(items), '2026-10-27');
    expect(summary.counts.map((c) => c.label)).toEqual([
      '2 exams',
      '1 quiz',
      '1 paper or project',
      '2 readings',
      '1 assignment',
    ]);
    expect(summary.total).toBe(7);
    expect(summary.dated).toBe(6);
    expect(summary.textbooks).toBe(1);
  });

  it('lists the next dated items from today, timed ones first within a day', () => {
    const summary = summarizeSnapshot(snapshot(items), '2026-10-27', 3);
    expect(summary.nextAreUpcoming).toBe(true);
    expect(summary.next.map((i) => i.title)).toEqual(['PS 5 + read ch. 5', 'Read ch. 4', 'Quiz 3']);
  });

  it('falls back to the first items when the course is over', () => {
    const summary = summarizeSnapshot(snapshot(items), '2027-02-01', 2);
    expect(summary.nextAreUpcoming).toBe(false);
    expect(summary.next.map((i) => i.title)).toEqual(['Midterm', 'PS 5 + read ch. 5']);
  });

  it('handles an empty snapshot', () => {
    const summary = summarizeSnapshot(snapshot([]), '2026-10-27');
    expect(summary.counts).toEqual([]);
    expect(summary.next).toEqual([]);
    expect(summary.nextAreUpcoming).toBe(false);
  });
});

describe('suggestShareTerm', () => {
  it('picks a term whose dates hold the course start', () => {
    const terms = [
      term({ id: 'spring', name: 'Spring 2026', start_date: '2026-01-10', end_date: '2026-05-10', is_active: true }),
      term({ id: 'fall', name: 'Autumn', start_date: '2026-08-20', end_date: '2026-12-20' }),
    ];
    expect(suggestShareTerm({ start_date: '2026-08-31' }, terms)).toEqual({ kind: 'existing', termId: 'fall' });
  });

  it('matches a term by season name', () => {
    const terms = [term({ id: 'f', name: 'fall 2026' }), term({ id: 'a', name: 'Other', is_active: true })];
    expect(suggestShareTerm({ start_date: '2026-09-02' }, terms)).toEqual({ kind: 'existing', termId: 'f' });
  });

  it('prefers the active term over creating one', () => {
    const terms = [term({ id: 'a', name: 'This year', is_active: true })];
    expect(suggestShareTerm({ start_date: '2026-09-02' }, terms)).toEqual({ kind: 'existing', termId: 'a' });
  });

  it('suggests a new seasonal term when nothing fits', () => {
    expect(suggestShareTerm({ start_date: '2027-01-12' }, [])).toEqual({ kind: 'new', name: 'Spring 2027' });
  });

  it('falls back to no term without dates or terms', () => {
    expect(suggestShareTerm({ start_date: null }, [])).toEqual({ kind: 'none' });
  });
});

describe('labels', () => {
  it('pluralizes counts', () => {
    expect(countLabel('quizzes', 1)).toBe('1 quiz');
    expect(countLabel('papers', 3)).toBe('3 papers & projects');
  });

  it('builds a byline from the parts present', () => {
    expect(courseByline({ code: 'MATH 221', section: '3', instructor: 'Dr. Okafor' })).toBe('MATH 221 · Sec 3 · Dr. Okafor');
    expect(courseByline({ code: null, section: ' ', instructor: null })).toBeNull();
  });
});
