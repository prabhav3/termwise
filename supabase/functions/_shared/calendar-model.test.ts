import { describe, expect, it } from 'vitest';
import {
  addDays,
  blockEntry,
  type CalendarEntry,
  diffDays,
  effectiveWeights,
  entryHash,
  formatDateLabel,
  formatTimeLabel,
  isHighImpact,
  itemEntry,
  type LinkState,
  localToUtcIso,
  mapLimit,
  planCalendarSync,
  type PendingChange,
  resolveTimeZone,
  timedRange,
  todayInZone,
  tzOffsetMinutes,
  utcToLocal,
  type WeightedItem,
} from './calendar-model.ts';

describe('time zones', () => {
  it('converts UTC instants into the student’s local date and time', () => {
    // Canvas "due 11:59 PM Eastern" arrives as the next day in UTC.
    expect(utcToLocal('2026-11-04T04:59:00Z', 'America/New_York')).toEqual({ date: '2026-11-03', time: '23:59' });
    expect(utcToLocal('2026-07-01T03:59:00Z', 'America/New_York')).toEqual({ date: '2026-06-30', time: '23:59' });
    expect(utcToLocal('2026-10-27T18:30:00Z', 'Asia/Kolkata')).toEqual({ date: '2026-10-28', time: '00:00' });
    expect(utcToLocal('2026-10-27T09:15:00Z', 'Pacific/Chatham')).toEqual({ date: '2026-10-27', time: '23:00' });
    expect(utcToLocal('2026-01-01T00:00:00Z', 'UTC')).toEqual({ date: '2026-01-01', time: '00:00' });
  });

  it('reports offsets including half-hour zones', () => {
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15), 'America/New_York')).toBe(-300);
    expect(tzOffsetMinutes(Date.UTC(2026, 6, 15), 'America/New_York')).toBe(-240);
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(330);
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15), 'Australia/Adelaide')).toBe(630);
  });

  it('converts local wall time back to UTC across DST edges', () => {
    expect(localToUtcIso('2026-11-03', '23:59', 'America/New_York')).toBe('2026-11-04T04:59:00.000Z');
    expect(localToUtcIso('2026-07-01', '09:00', 'America/Los_Angeles')).toBe('2026-07-01T16:00:00.000Z');
    // Spring forward (2026-03-08 02:00 → 03:00): 02:30 does not exist and moves forward.
    expect(localToUtcIso('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    // Fall back (2026-11-01 02:00 → 01:00): 01:30 happens twice; take the first.
    expect(localToUtcIso('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    expect(localToUtcIso('2026-04-05', '02:30', 'Australia/Sydney')).toBe('2026-04-04T15:30:00.000Z');
  });

  it('round-trips every hour of DST-change days', () => {
    // Europe/London 2026: spring forward 03-29 01:00, fall back 10-25 02:00.
    for (const day of ['2026-03-29', '2026-10-25']) {
      for (let h = 0; h < 24; h++) {
        const time = `${String(h).padStart(2, '0')}:15`;
        const back = utcToLocal(localToUtcIso(day, time, 'Europe/London'), 'Europe/London');
        expect(back.date).toBe(day);
        // 01:15 on the spring-forward day does not exist and becomes 02:15.
        expect(back.time).toBe(day === '2026-03-29' && h === 1 ? '02:15' : time);
      }
    }
  });

  it('handles date arithmetic and labels', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2026-10-27', '2026-11-03')).toBe(7);
    expect(todayInZone('America/Los_Angeles', Date.UTC(2026, 9, 28, 3))).toBe('2026-10-27');
    expect(formatDateLabel('2026-11-03')).toBe('Tue, Nov 3');
    expect(formatTimeLabel('16:30')).toBe('4:30 PM');
    expect(formatTimeLabel('00:05')).toBe('12:05 AM');
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
    expect(resolveTimeZone('Europe/Paris')).toBe('Europe/Paris');
  });
});

const baseItem = (over: Partial<WeightedItem> & { id: string }): WeightedItem => ({
  component_id: null,
  kind: 'homework',
  weight_override: null,
  is_major: false,
  high_impact_override: null,
  ...over,
});

describe('weights', () => {
  it('splits a component across its items, honouring expected_count and drop_lowest', () => {
    const components = [
      { id: 'quizzes', weight: 20, expected_count: 5, drop_lowest: 1 },
      { id: 'midterm', weight: 25, expected_count: null, drop_lowest: 0 },
      { id: 'empty', weight: 10, expected_count: null, drop_lowest: 0 },
    ];
    const items = [
      baseItem({ id: 'q1', component_id: 'quizzes', kind: 'quiz' }),
      baseItem({ id: 'q2', component_id: 'quizzes', kind: 'quiz' }),
      baseItem({ id: 'mt', component_id: 'midterm', kind: 'exam' }),
      baseItem({ id: 'override', component_id: 'quizzes', weight_override: 12 }),
      baseItem({ id: 'loose' }),
    ];
    const w = effectiveWeights(items, components);
    expect(w.get('q1')).toBe(5); // 20 / (5 - 1)
    expect(w.get('mt')).toBe(25);
    expect(w.get('override')).toBe(12);
    expect(w.get('loose')).toBeNull();
  });

  it('applies the high-impact rules from ENGINE.md', () => {
    expect(isHighImpact(baseItem({ id: 'a' }), 15, 15)).toBe(true);
    expect(isHighImpact(baseItem({ id: 'b', kind: 'exam' }), 8, 15)).toBe(true);
    expect(isHighImpact(baseItem({ id: 'c', kind: 'quiz' }), 8, 15)).toBe(false);
    expect(isHighImpact(baseItem({ id: 'd', is_major: true }), null, 15)).toBe(true);
    expect(isHighImpact(baseItem({ id: 'e', high_impact_override: false }), 40, 15)).toBe(false);
  });
});

const course = { id: 'c1', code: 'PSY 101', title: 'Intro to Psychology' };

describe('entries', () => {
  it('builds item entries with ★, weight and deep link', () => {
    const entry = itemEntry(
      { ...baseItem({ id: 'i1', kind: 'exam' }), title: 'Midterm 1', due_date: '2026-11-03', due_time: '16:30:00', status: 'todo' },
      course,
      25,
      true,
      'America/New_York',
    );
    expect(entry.key).toBe('item:i1');
    expect(entry.title).toBe('★ PSY 101: Midterm 1');
    expect(entry.time).toBe('16:30');
    expect(entry.description).toContain('Worth 25% of PSY 101');
    expect(entry.description).toContain('termwise://item/i1');
    const { startMs, endMs } = timedRange(entry);
    expect(new Date(endMs).toISOString()).toBe('2026-11-03T21:30:00.000Z');
    expect(endMs - startMs).toBe(30 * 60_000);
  });

  it('builds block entries and stable hashes', async () => {
    const block = blockEntry({ key: 'read:i2:1', item_id: 'i2', date: '2026-11-01', minutes: 45, kind: 'reading', label: 'Read pp. 101–125' }, course, 'UTC');
    expect(block.key).toBe('block:read:i2:1');
    expect(block.time).toBeNull();
    const h1 = await entryHash(block, 'event');
    expect(h1).toBe(await entryHash({ ...block }, 'event'));
    expect(h1).not.toBe(await entryHash(block, 'task'));
    expect(h1).not.toBe(await entryHash({ ...block, date: '2026-11-02' }, 'event'));
  });
});

const entry = (key: string, date: string, itemId: string | null = key.replace('item:', '')): CalendarEntry => ({
  key,
  itemId,
  title: key,
  description: '',
  date,
  time: null,
  durationMinutes: 30,
  timeZone: 'UTC',
  url: 'termwise://item/x',
});
const link = (key: string, externalId: string, hash: string | null, pushedDate: string, kind: 'event' | 'task' = 'event'): LinkState => ({
  id: `link-${key}`,
  key,
  external_id: externalId,
  external_kind: kind,
  pushed_hash: hash,
  pushed_date: pushedDate,
  deleted_externally: false,
});
const noPending = new Map<string, PendingChange>();

describe('planCalendarSync', () => {
  it('creates new entries, updates changed ones, and removes stale links', () => {
    const plan = planCalendarSync({
      desired: [
        { entry: entry('item:new', '2026-11-01'), hash: 'h-new' },
        { entry: entry('item:changed', '2026-11-02'), hash: 'h2' },
        { entry: entry('item:same', '2026-11-03'), hash: 'h3' },
      ],
      links: [link('item:changed', 'e-changed', 'h-old', '2026-11-01'), link('item:same', 'e-same', 'h3', '2026-11-03'), link('item:gone', 'e-gone', 'h', '2026-10-01')],
      kind: 'event',
      snapshot: null,
      pendingChanges: noPending,
    });
    expect(plan.create.map((d) => d.entry.key)).toEqual(['item:new']);
    expect(plan.update.map((u) => u.externalId)).toEqual(['e-changed']);
    expect(plan.remove.map((l) => l.key)).toEqual(['item:gone']);
    expect(plan.unchanged.map((l) => l.key)).toEqual(['item:same']);
    expect(plan.externalChanges).toEqual([]);
  });

  it('turns an external date edit on an unchanged entry into an external change (and does not push)', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [link('item:a', 'e-a', 'h', '2026-11-03')],
      kind: 'event',
      snapshot: { complete: false, observations: [{ externalId: 'e-a', deleted: false, date: '2026-11-05', time: '10:00', key: 'item:a' }] },
      pendingChanges: noPending,
    });
    expect(plan.externalChanges).toEqual([{ itemId: 'a', key: 'item:a', newDate: '2026-11-05', newTime: '10:00', deleted: false }]);
    expect(plan.update).toEqual([]);
  });

  it('lets our change win when both sides changed', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-04'), hash: 'h-new' }],
      links: [link('item:a', 'e-a', 'h-old', '2026-11-03')],
      kind: 'event',
      snapshot: { complete: true, observations: [{ externalId: 'e-a', deleted: false, date: '2026-11-05', time: null, key: 'item:a' }] },
      pendingChanges: noPending,
    });
    expect(plan.externalChanges).toEqual([]);
    expect(plan.update.map((u) => u.externalId)).toEqual(['e-a']);
  });

  it('pushes our date back after a rejection (pushed_hash cleared)', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [link('item:a', 'e-a', null, '2026-11-03')],
      kind: 'event',
      snapshot: { complete: true, observations: [{ externalId: 'e-a', deleted: false, date: '2026-11-05', time: null, key: 'item:a' }] },
      pendingChanges: noPending,
    });
    expect(plan.update.map((u) => u.externalId)).toEqual(['e-a']);
    expect(plan.externalChanges).toEqual([]);
  });

  it('reports external deletions once and does not resurrect them while pending', () => {
    const first = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [link('item:a', 'e-a', 'h', '2026-11-03')],
      kind: 'event',
      snapshot: { complete: true, observations: [] },
      pendingChanges: noPending,
    });
    expect(first.externalChanges).toEqual([{ itemId: 'a', key: 'item:a', newDate: null, newTime: null, deleted: true }]);
    expect(first.tombstones.map((l) => l.key)).toEqual(['item:a']);
    expect(first.dropLinks).toEqual([]);
    expect(first.create).toEqual([]);

    const pendingDeletion = new Map([['a', { new_due_date: null, new_due_time: null, deleted: true }]]);
    const second = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [{ ...link('item:a', 'e-a', 'h', '2026-11-03'), deleted_externally: true }],
      kind: 'event',
      snapshot: { complete: true, observations: [] },
      pendingChanges: pendingDeletion,
    });
    expect(second).toMatchObject({ create: [], update: [], dropLinks: [], tombstones: [], externalChanges: [] });

    // A link dropped before tombstones existed.
    const legacy = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [],
      kind: 'event',
      snapshot: { complete: true, observations: [] },
      pendingChanges: pendingDeletion,
    });
    expect(legacy.create).toEqual([]);
  });

  it('keeps an accepted deletion ("Mark done") off the calendar on later syncs', () => {
    const tombstone = { ...link('item:a', 'e-a', 'h', '2026-11-03'), deleted_externally: true };
    // Done changes the summary ("✓ …"), so the desired hash no longer matches pushed_hash.
    const doneEntry = { entry: { ...entry('item:a', '2026-11-03'), title: '✓ item:a' }, hash: 'h-done' };
    for (const snapshot of [null, { complete: true, observations: [] }, { complete: false, observations: [] }]) {
      const plan = planCalendarSync({
        desired: [doneEntry],
        links: [tombstone],
        kind: 'event',
        snapshot,
        pendingChanges: noPending,
        doneItems: new Set(['a']),
      });
      expect(plan).toMatchObject({ create: [], update: [], remove: [], dropLinks: [], removeOrphans: [], externalChanges: [] });
    }
    // Also after switching delivery to tasks.
    const switched = planCalendarSync({
      desired: [{ ...doneEntry, hash: 'h-done-task' }],
      links: [tombstone],
      kind: 'task',
      snapshot: { complete: true, observations: [] },
      pendingChanges: noPending,
      doneItems: new Set(['a']),
    });
    expect(switched.create).toEqual([]);
  });

  it('brings a deleted item back on "Keep it" (pushed_hash cleared) or when the item is reopened', () => {
    const tombstone = { ...link('item:a', 'e-a', 'h', '2026-11-03'), deleted_externally: true };
    const desired = { entry: entry('item:a', '2026-11-03'), hash: 'h' };
    const kept = planCalendarSync({
      desired: [desired],
      links: [{ ...tombstone, pushed_hash: null }],
      kind: 'event',
      snapshot: { complete: true, observations: [] },
      pendingChanges: noPending,
      doneItems: new Set(['a']),
    });
    expect(kept.dropLinks.map((l) => l.id)).toEqual([tombstone.id]);
    expect(kept.create).toEqual([desired]);
    expect(kept.update).toEqual([]);

    const reopened = planCalendarSync({ desired: [desired], links: [tombstone], kind: 'event', snapshot: null, pendingChanges: noPending });
    expect(reopened.dropLinks.map((l) => l.id)).toEqual([tombstone.id]);
    expect(reopened.create).toEqual([desired]);
  });

  it('drops a tombstone without deleting anything once the item is no longer wanted', () => {
    const tombstone = { ...link('item:a', 'e-a', 'h', '2026-11-03'), deleted_externally: true };
    const plan = planCalendarSync({ desired: [], links: [tombstone], kind: 'event', snapshot: null, pendingChanges: noPending, doneItems: new Set(['a']) });
    expect(plan.dropLinks.map((l) => l.id)).toEqual([tombstone.id]);
    expect(plan.remove).toEqual([]);
  });

  it('does not re-report a change the student has not reviewed yet', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [link('item:a', 'e-a', 'h', '2026-11-03')],
      kind: 'event',
      snapshot: { complete: true, observations: [{ externalId: 'e-a', deleted: false, date: '2026-11-05', time: null, key: 'item:a' }] },
      pendingChanges: new Map([['a', { new_due_date: '2026-11-05', new_due_time: null }]]),
    });
    expect(plan.externalChanges).toEqual([]);
  });

  it('keeps a deleted plan block deleted until the block changes', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('block:b1', '2026-11-01', null), hash: 'hb' }],
      links: [link('block:b1', 'e-b', 'hb', '2026-11-01')],
      kind: 'event',
      snapshot: { complete: true, observations: [] },
      pendingChanges: noPending,
    });
    expect(plan.create).toEqual([]);
    expect(plan.externalChanges).toEqual([]);
    expect(plan.unchanged.map((l) => l.key)).toEqual(['block:b1']);
  });

  it('recreates entries when the delivery kind changes', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h-task' }],
      links: [link('item:a', 'e-a', 'h', '2026-11-03', 'event')],
      kind: 'task',
      snapshot: null,
      pendingChanges: noPending,
    });
    expect(plan.remove.map((l) => l.external_id)).toEqual(['e-a']);
    expect(plan.create.map((d) => d.entry.key)).toEqual(['item:a']);
  });

  it('removes the old kind even when the new container was fully listed', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h-task' }],
      links: [link('item:a', 'e-a', 'h', '2026-11-03', 'event')],
      kind: 'task',
      snapshot: { complete: true, observations: [] },
      pendingChanges: noPending,
    });
    expect(plan.remove.map((l) => l.external_id)).toEqual(['e-a']);
    expect(plan.dropLinks).toEqual([]);
    expect(plan.create.map((d) => d.entry.key)).toEqual(['item:a']);
  });

  it('adopts our orphaned events by key and deletes unwanted ones', () => {
    const plan = planCalendarSync({
      desired: [{ entry: entry('item:a', '2026-11-03'), hash: 'h' }],
      links: [],
      kind: 'event',
      snapshot: {
        complete: true,
        observations: [
          { externalId: 'old-a', deleted: false, date: '2026-11-03', time: null, key: 'item:a' },
          { externalId: 'old-z', deleted: false, date: '2026-09-01', time: null, key: 'item:z' },
          { externalId: 'mine', deleted: false, date: '2026-09-01', time: null, key: null },
        ],
      },
      pendingChanges: noPending,
    });
    expect(plan.update).toEqual([{ desired: expect.anything(), externalId: 'old-a', linkId: null }]);
    expect(plan.create).toEqual([]);
    expect(plan.removeOrphans).toEqual(['old-z']);
  });
});

describe('mapLimit', () => {
  it('keeps order and bounds concurrency', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});
