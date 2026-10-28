import { describe, expect, it } from 'vitest';

import {
  buildDesiredEntries,
  entryHash,
  instantToZoned,
  isPlanEmpty,
  itemKey,
  planAppleSync,
  stringHash,
  type DesiredEntry,
  type DesiredInput,
  type EntryBlock,
  type EntryCourse,
  type EntryItem,
  type LinkState,
  type Observation,
  type PendingChange,
} from './diff';

const TZ = 'America/New_York';

const course: EntryCourse = { id: 'c1', code: 'PSY 101', title: 'Intro Psychology', archived: false };
const archived: EntryCourse = { id: 'c2', code: 'OLD 1', title: 'Old course', archived: true };

function item(overrides: Partial<EntryItem> = {}): EntryItem {
  return {
    id: 'i1',
    course_id: 'c1',
    title: 'Midterm 1',
    kind: 'exam',
    due_date: '2026-11-06',
    due_time: null,
    status: 'todo',
    ...overrides,
  };
}

function block(overrides: Partial<EntryBlock> = {}): EntryBlock {
  return {
    key: 'b1',
    item_id: 'i1',
    course_id: 'c1',
    date: '2026-10-30',
    minutes: 45,
    label: 'Study for Midterm 1 — 45 min',
    status: 'planned',
    ...overrides,
  };
}

function input(overrides: Partial<DesiredInput> = {}): DesiredInput {
  return {
    items: [item()],
    courses: [course, archived],
    blocks: [],
    includeBlocks: false,
    today: '2026-10-27',
    timeZone: TZ,
    kind: 'event',
    weights: new Map([['i1', 25]]),
    highImpactIds: new Set(['i1']),
    ...overrides,
  };
}

function linkFor(desired: DesiredEntry, overrides: Partial<LinkState> = {}): LinkState {
  return {
    id: `link-${desired.entry.key}`,
    key: desired.entry.key,
    external_id: `ext-${desired.entry.key}`,
    external_kind: 'event',
    pushed_hash: desired.hash,
    pushed_date: desired.entry.date,
    deleted_externally: false,
    ...overrides,
  };
}

const noPending = new Map<string, PendingChange>();

describe('buildDesiredEntries', () => {
  it('pushes dated items of active courses with a high-impact mark and weight', () => {
    const [desired, ...rest] = buildDesiredEntries(
      input({ items: [item(), item({ id: 'i2', due_date: null }), item({ id: 'i3', course_id: 'c2' })] }),
    );
    expect(rest).toHaveLength(0);
    expect(desired.entry).toMatchObject({
      key: 'item:i1',
      itemId: 'i1',
      title: '★ PSY 101: Midterm 1',
      date: '2026-11-06',
      time: null,
      url: 'termwise://item/i1',
    });
    expect(desired.entry.notes).toContain('Exam · Worth 25% of PSY 101');
  });

  it('marks done items and normalizes due times', () => {
    const [desired] = buildDesiredEntries(input({ items: [item({ status: 'done', due_time: '16:30:00' })] }));
    expect(desired.entry.title).toBe('✓ PSY 101: Midterm 1');
    expect(desired.entry.time).toBe('16:30');
    expect(desired.entry.notes).toContain('Due 4:30 PM');
  });

  it('adds planned blocks for the next 30 days only when asked', () => {
    const blocks = [
      block(),
      block({ key: 'b-past', date: '2026-10-26' }),
      block({ key: 'b-far', date: '2026-11-26' }),
      block({ key: 'b-done', status: 'done' }),
      block({ key: 'b-archived', course_id: 'c2' }),
    ];
    expect(buildDesiredEntries(input({ blocks })).map((d) => d.entry.key)).toEqual(['item:i1']);
    const keys = buildDesiredEntries(input({ blocks, includeBlocks: true })).map((d) => d.entry.key);
    expect(keys).toEqual(['item:i1', 'block:b1']);
  });

  it('hashes deterministically and per delivery kind', () => {
    const [a] = buildDesiredEntries(input());
    const [b] = buildDesiredEntries(input());
    const [task] = buildDesiredEntries(input({ kind: 'task' }));
    expect(a.hash).toBe(b.hash);
    expect(task.hash).not.toBe(a.hash);
    expect(entryHash(a.entry, 'event')).toBe(a.hash);
    expect(stringHash('a')).not.toBe(stringHash('b'));
  });
});

describe('planAppleSync', () => {
  const [desired] = buildDesiredEntries(input());

  it('creates entries that have no link yet', () => {
    const plan = planAppleSync({ desired: [desired], links: [], kind: 'event', observed: new Map(), pending: noPending });
    expect(plan.create).toEqual([desired]);
    expect(isPlanEmpty(plan)).toBe(false);
  });

  it('leaves unchanged links alone', () => {
    const link = linkFor(desired);
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-06', time: null }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending: noPending });
    expect(plan.unchanged).toEqual([link]);
    expect(isPlanEmpty(plan)).toBe(true);
  });

  it('updates when our payload changed, even if the student moved the event', () => {
    const link = linkFor(desired, { pushed_hash: 'old' });
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-07', time: null }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending: noPending });
    expect(plan.update).toEqual([{ desired, link }]);
    expect(plan.externalChanges).toHaveLength(0);
  });

  it('re-pushes links whose pushed_hash was cleared ("Keep mine")', () => {
    const link = linkFor(desired, { pushed_hash: null });
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-09', time: null }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending: noPending });
    expect(plan.update).toHaveLength(1);
    expect(plan.externalChanges).toHaveLength(0);
  });

  it('reports a date the student moved in Calendar', () => {
    const link = linkFor(desired);
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-08', time: '09:00' }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending: noPending });
    expect(plan.externalChanges).toEqual([
      { itemId: 'i1', key: itemKey('i1'), newDate: '2026-11-08', newTime: '09:00', deleted: false },
    ]);
    expect(plan.unchanged).toEqual([link]);
  });

  it('does not re-report a change that is already pending', () => {
    const link = linkFor(desired);
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-08', time: null }]]);
    const pending = new Map<string, PendingChange>([['i1', { new_due_date: '2026-11-08', new_due_time: null }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending });
    expect(plan.externalChanges).toHaveLength(0);
  });

  it('skips items with a pending decision from another provider', () => {
    const link = linkFor(desired);
    const observed = new Map<string, Observation>([[link.external_id, { found: true, date: '2026-11-08', time: null }]]);
    const plan = planAppleSync({
      desired: [desired],
      links: [link],
      kind: 'event',
      observed,
      pending: noPending,
      blockedItems: new Set(['i1']),
    });
    expect(plan.externalChanges).toHaveLength(0);
  });

  it('reports a deleted item event and keeps its link as a tombstone', () => {
    const link = linkFor(desired);
    const observed = new Map<string, Observation>([[link.external_id, { found: false }]]);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed, pending: noPending });
    expect(plan.externalChanges).toEqual([{ itemId: 'i1', key: 'item:i1', newDate: null, newTime: null, deleted: true }]);
    expect(plan.tombstones).toEqual([link]);
    expect(plan.dropLinks).toHaveLength(0);
    expect(plan.create).toHaveLength(0);
    expect(isPlanEmpty(plan)).toBe(false);
  });

  it('keeps an accepted deletion ("Mark done") off the device, and brings it back on "Keep it" or reopen', () => {
    const tombstone = linkFor(desired, { deleted_externally: true });
    const deletedPending = new Map<string, PendingChange>([['i1', { new_due_date: null, new_due_time: null, deleted: true }]]);
    const run = (link: LinkState, wanted: DesiredEntry, pending: ReadonlyMap<string, PendingChange>, done: string[]) =>
      planAppleSync({ desired: [wanted], links: [link], kind: 'event', observed: new Map(), pending, doneItems: new Set(done) });

    // Waiting for the decision.
    const waiting = run(tombstone, desired, deletedPending, []);
    expect(waiting.create).toHaveLength(0);
    expect(isPlanEmpty(waiting)).toBe(true);

    // "Mark done": status done, external_change cleared; the ✓ title changes the hash.
    const [doneDesired] = buildDesiredEntries(input({ items: [item({ status: 'done' })] }));
    expect(doneDesired.hash).not.toBe(desired.hash);
    const accepted = run(tombstone, doneDesired, noPending, ['i1']);
    expect(accepted.create).toHaveLength(0);
    expect(accepted.update).toHaveLength(0);
    expect(accepted.dropLinks).toHaveLength(0);
    expect(isPlanEmpty(accepted)).toBe(true);

    // "Keep it" clears pushed_hash (useKeepTermwiseDate): recreate, even for an already-done item.
    const kept = run({ ...tombstone, pushed_hash: null }, doneDesired, noPending, ['i1']);
    expect(kept.dropLinks).toEqual([{ ...tombstone, pushed_hash: null }]);
    expect(kept.create).toEqual([doneDesired]);

    // The student reopens the item later.
    const reopened = run(tombstone, desired, noPending, []);
    expect(reopened.dropLinks).toEqual([tombstone]);
    expect(reopened.create).toEqual([desired]);
  });

  it('drops a tombstone without touching the device once the item is no longer wanted', () => {
    const tombstone = linkFor(desired, { deleted_externally: true });
    const plan = planAppleSync({ desired: [], links: [tombstone], kind: 'event', observed: new Map(), pending: noPending, doneItems: new Set(['i1']) });
    expect(plan.dropLinks).toEqual([tombstone]);
    expect(plan.remove).toHaveLength(0);
  });

  it('does not recreate an item event the student deleted while the decision is pending', () => {
    const pending = new Map<string, PendingChange>([['i1', { new_due_date: null, new_due_time: null, deleted: true }]]);
    const plan = planAppleSync({ desired: [desired], links: [], kind: 'event', observed: new Map(), pending });
    expect(plan.create).toHaveLength(0);
  });

  it('keeps a deleted block deleted until the block changes', () => {
    const [, blockDesired] = buildDesiredEntries(input({ blocks: [block()], includeBlocks: true }));
    const link = linkFor(blockDesired);
    const gone = new Map<string, Observation>([[link.external_id, { found: false }]]);
    const same = planAppleSync({ desired: [blockDesired], links: [link], kind: 'event', observed: gone, pending: noPending });
    expect(same.unchanged).toEqual([link]);
    expect(same.create).toHaveLength(0);

    const changed = planAppleSync({
      desired: [blockDesired],
      links: [{ ...link, pushed_hash: 'stale' }],
      kind: 'event',
      observed: gone,
      pending: noPending,
    });
    expect(changed.dropLinks).toHaveLength(1);
    expect(changed.create).toEqual([blockDesired]);
  });

  it('removes entries that are no longer wanted, or only the link when already gone', () => {
    const stale: LinkState = { ...linkFor(desired), key: 'item:gone', external_id: 'ext-gone' };
    const missing: LinkState = { ...linkFor(desired), key: 'item:missing', external_id: 'ext-missing' };
    const observed = new Map<string, Observation>([['ext-missing', { found: false }]]);
    const plan = planAppleSync({ desired: [], links: [stale, missing], kind: 'event', observed, pending: noPending });
    expect(plan.remove).toEqual([stale]);
    expect(plan.dropLinks).toEqual([missing]);
  });

  it('moves entries across when the delivery switches from events to reminders', () => {
    const [taskDesired] = buildDesiredEntries(input({ kind: 'task' }));
    const eventLink = linkFor(desired);
    const plan = planAppleSync({ desired: [taskDesired], links: [eventLink], kind: 'task', observed: new Map(), pending: noPending });
    expect(plan.remove).toEqual([eventLink]);
    expect(plan.create).toEqual([taskDesired]);
  });

  it('treats unchecked links as unchanged (no false deletions)', () => {
    const link = linkFor(desired);
    const plan = planAppleSync({ desired: [desired], links: [link], kind: 'event', observed: new Map(), pending: noPending });
    expect(plan.unchanged).toEqual([link]);
    expect(plan.externalChanges).toHaveLength(0);
  });
});

describe('instantToZoned', () => {
  it('reads the wall clock in the student time zone', () => {
    expect(instantToZoned(new Date('2026-11-07T04:59:00Z'), TZ)).toEqual({ date: '2026-11-06', time: '23:59' });
    expect(instantToZoned(new Date('2026-11-07T05:00:00Z'), 'UTC')).toEqual({ date: '2026-11-07', time: '05:00' });
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(instantToZoned(new Date('2026-11-07T05:00:00Z'), 'Not/AZone')).toEqual({ date: '2026-11-07', time: '05:00' });
  });
});
