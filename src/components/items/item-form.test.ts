import { describe, expect, it } from 'vitest';

import type { Item } from '@/types/db';

import { EMPTY_READING, itemFormFrom, newItemForm, toItemPatch, toNewItem, validateItemForm, withKind } from './item-form';

const STAMP = '2026-09-01T00:00:00Z';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    user_id: 'user-1',
    course_id: 'course-1',
    component_id: 'comp-1',
    title: 'Problem Set 3',
    kind: 'homework',
    description: null,
    assigned_date: null,
    due_date: '2026-10-30',
    due_time: '23:59:00',
    weight_override: null,
    points_possible: 20,
    score: null,
    estimated_minutes: 120,
    reading: null,
    pages: null,
    status: 'todo',
    high_impact_override: null,
    is_major: false,
    source: 'ai',
    confidence: 0.9,
    source_quote: null,
    notes: null,
    canvas_assignment_id: null,
    lms_due_at: null,
    lms_lock_at: null,
    lms_unlock_at: null,
    external_change: null,
    completed_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

describe('item form', () => {
  it('writes nothing when nothing changed (Postgres HH:MM:SS times included)', () => {
    const row = item({ points_possible: 20, due_time: '23:59:00' });
    expect(toItemPatch(itemFormFrom(row), row)).toEqual({});
  });

  it('patches only the edited fields', () => {
    const row = item();
    const values = { ...itemFormFrom(row), title: '  Problem Set 3B ', dueDate: '2026-11-02' };
    expect(toItemPatch(values, row)).toEqual({ title: 'Problem Set 3B', due_date: '2026-11-02' });
  });

  it('drops the time when the date is cleared', () => {
    const row = item();
    const patch = toItemPatch({ ...itemFormFrom(row), dueDate: null }, row);
    expect(patch).toEqual({ due_date: null, due_time: null });
  });

  it('stores an empty reading as null and trims its description', () => {
    const empty = toNewItem({ ...newItemForm('reading'), title: 'Read', reading: EMPTY_READING }, 'course-1');
    expect(empty.reading).toBeNull();
    const described = toNewItem(
      { ...newItemForm('reading'), title: 'Read', reading: { ...EMPTY_READING, description: '  Miller (1956)  ' } },
      'course-1',
    );
    expect(described.reading).toEqual({ ...EMPTY_READING, description: 'Miller (1956)' });
  });

  it('creates manual to-do items with no work estimate for readings', () => {
    const row = toNewItem({ ...newItemForm('reading'), title: ' Ch. 4 ', estimatedMinutes: 90 }, 'course-9');
    expect(row).toMatchObject({ course_id: 'course-9', title: 'Ch. 4', source: 'manual', status: 'todo', estimated_minutes: null });
  });

  it('follows the kind for "major" until the student overrides it', () => {
    const exam = withKind(newItemForm('homework'), 'exam');
    expect(exam.isMajor).toBe(true);
    const custom = withKind({ ...newItemForm('homework'), isMajor: true }, 'quiz');
    expect(custom.isMajor).toBe(true);
    expect(withKind(exam, 'quiz').isMajor).toBe(false);
  });

  it('needs a title and an available date before the due date', () => {
    expect(validateItemForm(newItemForm()).title).not.toBeNull();
    const values = { ...newItemForm(), title: 'Lab', dueDate: '2026-10-01', assignedDate: '2026-10-05' };
    expect(validateItemForm(values)).toEqual({ title: null, assignedDate: 'After the due date' });
  });
});
