import { describe, expect, it } from 'vitest';

import { buildPlan } from '@/engine';
import { makeInput, makeItem, makeReading, makeTextbook } from '@/engine/__tests__/fixtures';
import type { EngineItem, EngineTextbook } from '@/engine';

import { normalizeChapters, normalizeItemRow, normalizeReading, normalizeTextbookRow } from './json-columns';

describe('normalizeReading', () => {
  it('keeps a well-formed reading as is', () => {
    const reading = {
      textbook_id: 'tb1',
      chapters: ['4', '5'],
      page_ranges: [{ start: 10, end: 20 }],
      explicit_pages: null,
      description: 'Miller (1956)',
    };
    expect(normalizeReading(reading)).toEqual(reading);
  });

  it('is null for anything but an object', () => {
    for (const value of [null, undefined, 'ch 4', 12, true, [], [{ chapters: [] }]]) {
      expect(normalizeReading(value)).toBeNull();
    }
  });

  it('fills missing fields of an empty object (a shared item with reading {})', () => {
    expect(normalizeReading({})).toEqual(makeReading());
  });

  it('drops mistyped fields and entries', () => {
    expect(
      normalizeReading({
        textbook_id: 7,
        chapters: ['3', 4, null, { n: 1 }, Number.NaN],
        page_ranges: [{ start: 1, end: 9 }, { start: '1', end: 2 }, null, 'pp. 4-6', { start: 5 }],
        explicit_pages: '30',
        description: ['x'],
      }),
    ).toEqual({ textbook_id: null, chapters: ['3', '4'], page_ranges: [{ start: 1, end: 9 }], explicit_pages: null, description: null });
    expect(normalizeReading({ chapters: '4-7', page_ranges: { start: 1, end: 2 } })).toEqual(makeReading());
  });
});

describe('normalizeChapters', () => {
  it('keeps a well-formed chapter map', () => {
    const chapters = [
      { number: '1', title: 'Intro', start_page: 1, end_page: 20 },
      { number: '2', title: null, start_page: null, end_page: null },
    ];
    expect(normalizeChapters(chapters)).toEqual(chapters);
  });

  it('is empty for anything but an array', () => {
    for (const value of [null, undefined, {}, '1-3', 4]) expect(normalizeChapters(value)).toEqual([]);
  });

  it('drops entries without a chapter number and nulls mistyped fields', () => {
    expect(
      normalizeChapters([
        { number: 3, title: 9, start_page: '10', end_page: 30 },
        { title: 'No number', start_page: 1, end_page: 2 },
        null,
        'ch 4',
        {},
      ]),
    ).toEqual([{ number: '3', title: null, start_page: null, end_page: 30 }]);
  });
});

describe('normalized rows reach the planner safely', () => {
  // Shapes RLS (and import_shared_timeline) let into the jsonb columns.
  const badReading = makeItem({ id: 'i1', kind: 'reading', reading: {} as EngineItem['reading'] });
  const badChapters = makeItem({
    id: 'i2',
    kind: 'reading',
    reading: makeReading({ textbook_id: 'tb1', chapters: ['1', '2'] }),
  });
  const badBook = makeTextbook({ chapters: { 1: 'oops' } as unknown as EngineTextbook['chapters'] });

  it('a malformed row would throw in buildPlan', () => {
    expect(() => buildPlan(makeInput({ items: [badReading] }))).toThrow();
    expect(() => buildPlan(makeInput({ items: [badChapters], textbooks: [badBook] }))).toThrow();
  });

  it('plans once the rows are normalized', () => {
    const input = makeInput({
      items: [badReading, badChapters].map(normalizeItemRow),
      textbooks: [badBook].map(normalizeTextbookRow),
    });
    const result = buildPlan(input);
    // The chapter list still plans at the default pages per chapter.
    expect(result.blocks.some((block) => block.item_id === 'i2' && block.kind === 'reading')).toBe(true);
  });
});
