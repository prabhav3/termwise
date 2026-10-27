import { describe, expect, it } from 'vitest';
import { computeDayLoads } from '../index';
import { makeBlock, makeSettings } from './fixtures';

describe('computeDayLoads', () => {
  const settings = makeSettings({ study_days: [1, 2, 3, 4, 5], daily_capacity_minutes: 120, blackout_dates: ['2026-10-29'] });

  it('returns one entry per day in the inclusive range', () => {
    const days = computeDayLoads([], settings, '2026-10-27', '2026-11-02');
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(computeDayLoads([], settings, '2026-11-02', '2026-10-27')).toEqual([]);
  });

  it('gives study days full capacity and weekends/blackouts none', () => {
    const days = computeDayLoads([], settings, '2026-10-27', '2026-11-01');
    expect(days.map((d) => [d.date, d.capacity, d.isStudyDay])).toEqual([
      ['2026-10-27', 120, true],
      ['2026-10-28', 120, true],
      ['2026-10-29', 0, false], // blackout
      ['2026-10-30', 120, true],
      ['2026-10-31', 0, false], // Saturday
      ['2026-11-01', 0, false], // Sunday
    ]);
  });

  it('separates planned from done minutes, counts pages and ignores missed/skipped work', () => {
    const blocks = [
      makeBlock({ key: 'a', minutes: 45, kind: 'reading', page_start: 101, page_end: 115 }),
      makeBlock({ key: 'b', minutes: 30 }),
      makeBlock({ key: 'c', minutes: 20, status: 'done' }),
      makeBlock({ key: 'd', minutes: 60, status: 'missed' }),
      makeBlock({ key: 'e', minutes: 60, status: 'skipped' }),
      makeBlock({ key: 'f', minutes: 90, date: '2026-12-01' }), // outside the range
    ];
    const [today] = computeDayLoads(blocks, settings, '2026-10-27', '2026-10-27');
    expect(today).toEqual({
      date: '2026-10-27',
      minutes: 75,
      doneMinutes: 20,
      capacity: 120,
      pages: 15,
      blockCount: 2,
      overloaded: false,
      isStudyDay: true,
    });
  });

  it('flags a day as overloaded when planned plus done work exceeds capacity', () => {
    const blocks = [
      makeBlock({ key: 'a', minutes: 100 }),
      makeBlock({ key: 'b', minutes: 30, status: 'done' }),
      makeBlock({ key: 'c', minutes: 30, date: '2026-10-31' }), // planned on a Saturday
      makeBlock({ key: 'd', minutes: 200, date: '2026-10-28', status: 'done' }), // done only: not overloaded
    ];
    const days = computeDayLoads(blocks, settings, '2026-10-27', '2026-10-31');
    expect(days.filter((d) => d.overloaded).map((d) => d.date)).toEqual(['2026-10-27', '2026-10-31']);
  });
});
