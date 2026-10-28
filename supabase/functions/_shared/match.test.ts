import { describe, expect, it } from 'vitest';
import {
  buildItemDiscrepancies,
  courseLabelScore,
  dateProximity,
  type ExistingDiscrepancy,
  kindCompatibility,
  type LmsSide,
  matchCandidates,
  matchFeedCourses,
  normalizeTitle,
  planDiscrepancyWrites,
  type SyllabusSide,
  titleSimilarity,
  titleTokens,
} from './match.ts';

describe('title normalization', () => {
  it('normalizes punctuation, numbering, and synonyms', () => {
    expect(normalizeTitle('Quiz #1: Memory & Learning')).toBe('quiz 1 memory and learning');
    expect(normalizeTitle('HW3')).toBe('hw 3');
    expect(titleTokens('Exam II (Midterm)')).toEqual(['exam', '2', 'midterm']);
    expect(titleTokens('Homework Three')).toEqual(['hw', '3']);
    expect(titleTokens('Problem Set 03')).toEqual(['hw', '3']);
    expect(titleTokens('Assignment: Research Paper')).toEqual(['research', 'paper']);
    expect(titleTokens('Mid-term Exam')).toEqual(['midterm', 'exam']);
  });
});

describe('titleSimilarity', () => {
  it('matches the same assessment written differently', () => {
    expect(titleSimilarity('Quiz #1', 'Quiz 1: Memory')).toBeGreaterThan(0.85);
    expect(titleSimilarity('Midterm Exam', 'Exam 1 (Midterm)')).toBeGreaterThan(0.85);
    expect(titleSimilarity('Homework 3', 'Assignment 3')).toBeGreaterThan(0.85);
    expect(titleSimilarity('Research Paper', 'Research Paper Final Draft')).toBeGreaterThan(0.75);
  });

  it('keeps different instances and qualifiers apart', () => {
    expect(titleSimilarity('Quiz 1', 'Quiz 2')).toBeLessThan(0.2);
    expect(titleSimilarity('Quiz 3 (Chapter 1)', 'Quiz 1')).toBeLessThan(0.2);
    expect(titleSimilarity('Midterm Exam', 'Final Exam')).toBeLessThan(0.2);
    expect(titleSimilarity('Exam 2', 'Lab 4 report')).toBeLessThan(0.2);
    expect(titleSimilarity('', 'Quiz 1')).toBe(0);
  });
});

describe('kind and date signals', () => {
  it('scores kind compatibility', () => {
    expect(kindCompatibility('exam', 'exam')).toBe(1);
    expect(kindCompatibility('reading', 'exam')).toBe(0);
    expect(kindCompatibility('paper', 'homework')).toBe(0.6);
    expect(kindCompatibility(null, 'quiz')).toBe(0.6);
  });

  it('decays with date distance', () => {
    expect(dateProximity('2026-11-03', '2026-11-03')).toBe(1);
    expect(dateProximity('2026-11-03', '2026-11-04')).toBe(0.85);
    expect(dateProximity('2026-11-03', '2026-12-03')).toBe(0.05);
    expect(dateProximity(null, '2026-11-03')).toBeNull();
  });
});

describe('matchCandidates', () => {
  it('pairs syllabus items with Canvas assignments one-to-one', () => {
    const syllabus = [
      { id: 's-q1', title: 'Quiz #1', kind: 'quiz', date: '2026-09-14' },
      { id: 's-q2', title: 'Quiz #2', kind: 'quiz', date: '2026-09-28' },
      { id: 's-mid', title: 'Midterm Exam', kind: 'exam', date: '2026-10-15' },
      { id: 's-final', title: 'Final Exam', kind: 'exam', date: '2026-12-10' },
      { id: 's-read', title: 'Read Chapter 4', kind: 'reading', date: '2026-09-10' },
    ];
    const canvas = [
      { id: 'c-q2', title: 'Quiz 2: Perception', kind: 'quiz', date: '2026-09-28' },
      { id: 'c-q1', title: 'Quiz 1: Memory', kind: 'quiz', date: '2026-09-15' },
      { id: 'c-mid', title: 'Exam 1 (Midterm)', kind: 'exam', date: '2026-10-17' },
      { id: 'c-disc', title: 'Discussion: Week 3', kind: 'discussion', date: '2026-09-20' },
    ];
    const result = matchCandidates(syllabus, canvas);
    const pairs = Object.fromEntries(result.pairs.map((p) => [p.a.id, p.b.id]));
    expect(pairs).toEqual({ 's-q1': 'c-q1', 's-q2': 'c-q2', 's-mid': 'c-mid' });
    expect(result.unmatchedA.map((a) => a.id).sort()).toEqual(['s-final', 's-read']);
    expect(result.unmatchedB.map((b) => b.id)).toEqual(['c-disc']);
  });

  it('uses the date to choose between equally named candidates', () => {
    const result = matchCandidates(
      [{ id: 's', title: 'Response Paper', kind: 'paper', date: '2026-10-02' }],
      [
        { id: 'early', title: 'Response Paper', kind: 'paper', date: '2026-09-01' },
        { id: 'close', title: 'Response Paper', kind: 'paper', date: '2026-10-03' },
      ],
    );
    expect(result.pairs.map((p) => p.b.id)).toEqual(['close']);
  });

  it('does not force weak matches', () => {
    const result = matchCandidates(
      [{ id: 's', title: 'Paper 1 Proposal', kind: 'paper', date: '2026-09-01' }],
      [{ id: 'c', title: 'Paper 1 Final', kind: 'paper', date: '2026-11-20' }],
    );
    expect(result.pairs).toEqual([]);
  });
});

const syl = (over: Partial<SyllabusSide> & { id: string; title: string }): SyllabusSide => ({
  kind: 'homework',
  due_date: null,
  due_time: null,
  is_major: false,
  points_possible: null,
  ...over,
});
const lms = (over: Partial<LmsSide> & { external_id: string; title: string }): LmsSide => ({
  due_date: null,
  due_time: null,
  lock_date: null,
  lock_time: null,
  points_possible: null,
  ...over,
});

describe('buildItemDiscrepancies', () => {
  it('reports date, lock, points, and missing discrepancies with stable keys', () => {
    const records = buildItemDiscrepancies({
      scope: 'canvas:conn:course',
      lmsName: 'Canvas',
      checkLocks: true,
      checkPoints: true,
      pairs: [
        {
          syllabus: syl({ id: 'i1', title: 'Midterm', kind: 'exam', due_date: '2026-10-15', points_possible: 100 }),
          lms: lms({ external_id: 'a1', title: 'Exam 1 (Midterm)', due_date: '2026-10-17', due_time: '23:59', points_possible: 50 }),
        },
        {
          syllabus: syl({ id: 'i2', title: 'Essay', kind: 'paper', due_date: '2026-11-01' }),
          lms: lms({ external_id: 'a2', title: 'Essay', due_date: '2026-11-01', due_time: '23:59', lock_date: '2026-11-01', lock_time: '17:00' }),
        },
        {
          syllabus: syl({ id: 'i3', title: 'Lab 1', due_date: '2026-11-01', due_time: '17:00' }),
          lms: lms({ external_id: 'a3', title: 'Lab 1', due_date: '2026-11-01', lock_date: '2026-11-01', lock_time: '17:00' }),
        },
      ],
      unmatchedSyllabus: [syl({ id: 'i4', title: 'Final Project', kind: 'project', due_date: '2026-12-05' }), syl({ id: 'i5', title: 'Reading' })],
      unmatchedLms: [lms({ external_id: 'a9', title: 'Bonus Quiz', due_date: '2026-11-20' })],
    });
    const byKind = Object.fromEntries(records.map((r) => [`${r.kind}:${r.item_id ?? r.lms_external_id}`, r]));
    expect(Object.keys(byKind).sort()).toEqual([
      'date_mismatch:i1',
      'locks_before_due:i2',
      'missing_in_lms:i4',
      'missing_in_syllabus:a9',
      'points_mismatch:i1',
    ]);
    expect(byKind['date_mismatch:i1']).toMatchObject({
      syllabus_value: '2026-10-15',
      lms_value: '2026-10-17 23:59',
      dedupe_key: 'canvas:conn:course:date_mismatch:i1',
    });
    expect(byKind['date_mismatch:i1'].detail).toBe('Canvas lists this as due Oct 17, 11:59 PM, but the syllabus says Oct 15.');
    expect(byKind['locks_before_due:i2']).toMatchObject({ syllabus_value: '2026-11-01 23:59', lms_value: '2026-11-01 17:00' });
  });

  it('limits missing_in_lms to the feed window', () => {
    const records = buildItemDiscrepancies({
      scope: 'lms:conn',
      lmsName: 'Moodle',
      pairs: [],
      unmatchedSyllabus: [
        syl({ id: 'in', title: 'Exam 2', kind: 'exam', due_date: '2026-11-10' }),
        syl({ id: 'out', title: 'Final Exam', kind: 'exam', due_date: '2026-12-15' }),
      ],
      unmatchedLms: [],
      window: { from: '2026-10-01', to: '2026-11-30' },
    });
    expect(records.map((r) => r.item_id)).toEqual(['in']);
  });
});

describe('planDiscrepancyWrites', () => {
  const record = buildItemDiscrepancies({
    scope: 's',
    lmsName: 'Canvas',
    pairs: [
      {
        syllabus: syl({ id: 'i1', title: 'Midterm', due_date: '2026-10-15' }),
        lms: lms({ external_id: 'a1', title: 'Midterm', due_date: '2026-10-17' }),
      },
    ],
    unmatchedSyllabus: [],
    unmatchedLms: [],
  })[0];
  const existing = (over: Partial<ExistingDiscrepancy>): ExistingDiscrepancy => ({
    id: 'd1',
    dedupe_key: record.dedupe_key,
    status: 'open',
    title: record.title,
    detail: record.detail,
    syllabus_value: record.syllabus_value,
    lms_value: record.lms_value,
    ...over,
  });

  it('inserts new, skips unchanged, and resolves vanished discrepancies', () => {
    expect(planDiscrepancyWrites([], [record]).upsert).toEqual([record]);
    expect(planDiscrepancyWrites([existing({})], [record])).toEqual({ upsert: [], resolveIds: [] });
    expect(planDiscrepancyWrites([existing({})], [])).toEqual({ upsert: [], resolveIds: ['d1'] });
  });

  it('respects dismissals unless the values change, and reopens resolved ones', () => {
    expect(planDiscrepancyWrites([existing({ status: 'dismissed' })], [record]).upsert).toEqual([]);
    expect(planDiscrepancyWrites([existing({ status: 'dismissed', lms_value: '2026-10-16' })], [record]).upsert).toEqual([record]);
    expect(planDiscrepancyWrites([existing({ status: 'resolved' })], [record]).upsert).toEqual([record]);
    expect(planDiscrepancyWrites([existing({ status: 'dismissed' })], []).resolveIds).toEqual([]);
  });

  it('keeps a "Keep syllabus" / "Got it" decision (stored as dismissed) across later syncs', () => {
    const missing = buildItemDiscrepancies({
      scope: 's',
      lmsName: 'Canvas',
      pairs: [],
      unmatchedSyllabus: [],
      unmatchedLms: [lms({ external_id: 'a9', title: 'Extra credit', due_date: '2026-11-02' })],
    })[0];
    const decided = (record: typeof missing): ExistingDiscrepancy => ({
      id: 'd2',
      dedupe_key: record.dedupe_key,
      status: 'dismissed',
      title: record.title,
      detail: record.detail,
      syllabus_value: record.syllabus_value,
      lms_value: record.lms_value,
    });
    // The difference still exists on every sync, so the same records come back each time.
    expect(planDiscrepancyWrites([existing({ status: 'dismissed' }), decided(missing)], [record, missing])).toEqual({ upsert: [], resolveIds: [] });
  });

  it('pairs an item added from a feed event ("Add to my plan") with that event, so it is not offered again', () => {
    // useActOnDiscrepancy('add_item') creates kind 'other' with the event's title and date.
    const event = lms({ external_id: 'uid-7', title: 'Lab report 3', due_date: '2026-11-06', due_time: '23:59' });
    const added = syl({ id: 'new-item', title: 'Lab report 3', kind: 'other', due_date: '2026-11-06', due_time: '23:59' });
    const result = matchCandidates(
      [{ id: added.id, title: added.title, kind: added.kind, date: added.due_date }],
      [{ id: event.external_id, title: event.title, kind: 'lab', date: event.due_date }],
    );
    expect(result.pairs).toHaveLength(1);
    const records = buildItemDiscrepancies({
      scope: 's',
      lmsName: 'Moodle',
      pairs: [{ syllabus: added, lms: event }],
      unmatchedSyllabus: [],
      unmatchedLms: [],
    });
    expect(records).toEqual([]);
  });
});

describe('matchFeedCourses', () => {
  const courses = [
    { id: 'psy', code: 'PSY 101', title: 'Introduction to Psychology' },
    { id: 'bio', code: 'BIO 210', title: 'Cell Biology' },
    { id: 'his', code: null, title: 'Modern European History' },
  ];

  it('maps labels by code, title, and containment, one-to-one', () => {
    expect(courseLabelScore('PSY101', courses[0])).toBe(1);
    expect(courseLabelScore('PSY101-02-F26', courses[0])).toBe(0.9);
    const mapped = matchFeedCourses(['PSY101-02-F26', 'Cell Biology', 'Modern European History (Fall)', 'CHEM 120'], courses);
    expect(Object.fromEntries(mapped)).toEqual({ 'PSY101-02-F26': 'psy', 'Cell Biology': 'bio', 'Modern European History (Fall)': 'his' });
  });

  it('leaves weak labels unmapped', () => {
    expect(matchFeedCourses(['Psychology Club'], courses).size).toBe(0);
  });
});
