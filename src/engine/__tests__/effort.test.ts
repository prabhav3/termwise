import { describe, expect, it } from 'vitest';
import { annotateItems, DEFAULT_EFFORT_MINUTES, estimateEffortMinutes, resolveReadingPages } from '../index';
import { resolveReading } from '../pages';
import { makeComponent, makeInput, makeItem, makeReading, makeSettings, makeTextbook } from './fixtures';

const settings = makeSettings();
const textbook = makeTextbook({
  chapters: [
    { number: '4', title: 'Memory', start_page: 101, end_page: 126 },
    { number: '5', title: 'Learning', start_page: 127, end_page: 150 },
    { number: '6', title: 'Language', start_page: null, end_page: null },
  ],
});

describe('resolveReadingPages', () => {
  const reading = (overrides: Parameters<typeof makeReading>[0], itemOverrides: Parameters<typeof makeItem>[0] = {}) =>
    makeItem({ kind: 'reading', reading: makeReading(overrides), ...itemOverrides });

  it('follows pages → explicit_pages → page ranges → chapter map → chapters × default', () => {
    expect(resolveReadingPages(reading({ explicit_pages: 30 }, { pages: 12 }), [textbook], settings)).toBe(12);
    expect(resolveReadingPages(reading({ explicit_pages: 30, page_ranges: [{ start: 1, end: 5 }] }), [textbook], settings)).toBe(30);
    expect(
      resolveReadingPages(reading({ page_ranges: [{ start: 10, end: 20 }, { start: 30, end: 39 }], chapters: ['4'] }), [textbook], settings),
    ).toBe(21);
    expect(resolveReadingPages(reading({ textbook_id: 'tb1', chapters: ['4', '5'] }), [textbook], settings)).toBe(50);
    expect(resolveReadingPages(reading({ chapters: ['1', '2', '3'] }), [], settings)).toBe(75);
  });

  it('falls back to the default for chapters missing from the map', () => {
    expect(resolveReadingPages(reading({ textbook_id: 'tb1', chapters: ['4', '6', '9'] }), [textbook], settings)).toBe(26 + 25 + 25);
  });

  it("uses the course's only textbook when the reading names none, and normalises chapter names", () => {
    expect(resolveReadingPages(reading({ chapters: ['Ch. 4', 'Chapter 05'] }), [textbook], settings)).toBe(50);
  });

  it('merges overlapping page ranges instead of double counting', () => {
    expect(resolveReadingPages(reading({ page_ranges: [{ start: 10, end: 20 }, { start: 15, end: 25 }] }), [], settings)).toBe(16);
  });

  it('is null for non-readings without a reading ref and for readings with nothing to count', () => {
    expect(resolveReadingPages(makeItem({ kind: 'homework', pages: 10 }), [], settings)).toBeNull();
    expect(resolveReadingPages(makeItem({ kind: 'reading' }), [], settings)).toBeNull();
    expect(resolveReadingPages(makeItem({ kind: 'homework', reading: makeReading({ explicit_pages: 12 }) }), [], settings)).toBe(12);
  });

  it('keeps absolute page numbers when a range or chapter map is known, else relative pages', () => {
    const mapped = resolveReading(reading({ textbook_id: 'tb1', chapters: ['4', '5'] }), [textbook], settings);
    expect(mapped?.absolute).toBe(true);
    expect(mapped?.segments).toEqual([
      { start: 101, end: 126, chapter: '4' },
      { start: 127, end: 150, chapter: '5' },
    ]);
    const relative = resolveReading(reading({ explicit_pages: 40 }), [], settings);
    expect(relative).toEqual({ total: 40, segments: [{ start: 1, end: 40, chapter: null }], absolute: false });
    const ranged = resolveReading(reading({ textbook_id: 'tb1', page_ranges: [{ start: 120, end: 130 }] }), [textbook], settings);
    expect(ranged?.segments).toEqual([
      { start: 120, end: 126, chapter: '4' },
      { start: 127, end: 130, chapter: '5' },
    ]);
  });
});

describe('estimateEffortMinutes', () => {
  it('times readings by pages at the reading speed, at least 10 minutes', () => {
    const item = makeItem({ kind: 'reading' });
    expect(estimateEffortMinutes(item, 50, null, settings)).toBe(150);
    expect(estimateEffortMinutes(item, 2, null, settings)).toBe(10);
    expect(estimateEffortMinutes(item, 7, null, makeSettings({ reading_pages_per_hour: 30 }))).toBe(14);
    expect(estimateEffortMinutes(item, null, null, settings)).toBe(DEFAULT_EFFORT_MINUTES.reading);
  });

  it("uses the student's own estimate when set", () => {
    expect(estimateEffortMinutes(makeItem({ kind: 'paper', estimated_minutes: 45 }), null, 40, settings)).toBe(45);
  });

  it('scales the default by grade weight and rounds to 5 minutes', () => {
    const homework = makeItem({ kind: 'homework' });
    expect(estimateEffortMinutes(homework, null, null, settings)).toBe(90);
    expect(estimateEffortMinutes(homework, null, 3, settings)).toBe(55); // 90 × 0.6 = 54
    expect(estimateEffortMinutes(homework, null, 15, settings)).toBe(90);
    expect(estimateEffortMinutes(homework, null, 35, settings)).toBe(135);
    expect(estimateEffortMinutes(makeItem({ kind: 'exam' }), null, 25, settings)).toBe(450); // ×1.25 between 20% and 30%
    expect(estimateEffortMinutes(makeItem({ kind: 'paper' }), null, 7.5, settings)).toBe(480); // ×0.8 between 5% and 10%
  });
});

describe('annotateItems', () => {
  it('attaches impact, reading pages and effort to every item', () => {
    const input = makeInput({
      components: [makeComponent({ id: 'exams', weight: 50, expected_count: 2 })],
      textbooks: [textbook],
      items: [
        makeItem({ id: 'mid', kind: 'exam', title: 'Midterm 1', component_id: 'exams' }),
        makeItem({ id: 'read', kind: 'reading', reading: makeReading({ textbook_id: 'tb1', chapters: ['4'] }) }),
        makeItem({ id: 'hw', kind: 'homework', reading: makeReading({ explicit_pages: 12 }) }),
      ],
    });
    const [mid, read, hw] = annotateItems(input);
    expect(mid.impact.weight).toBe(25);
    expect(mid.effortMinutes).toBe(450);
    expect(read.resolvedPages).toBe(26);
    expect(read.effortMinutes).toBe(78);
    expect(hw.resolvedPages).toBeNull(); // reading-only by contract
    expect(hw.effortMinutes).toBe(90);
  });
});
