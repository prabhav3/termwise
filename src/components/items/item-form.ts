// Item form state for the manual item screen and the item editor: load, validate, save payload.
import type { NewRow, RowPatch } from '@/data';
import type { Item, ItemKind, ReadingRef } from '@/types/db';

export interface ItemFormValues {
  title: string;
  kind: ItemKind;
  dueDate: string | null;
  dueTime: string | null;
  assignedDate: string | null;
  componentId: string | null;
  weightOverride: number | null;
  pointsPossible: number | null;
  estimatedMinutes: number | null;
  isMajor: boolean;
  /** null = let Termwise decide. */
  highImpact: boolean | null;
  description: string;
  notes: string;
  reading: ReadingRef | null;
}

export const EMPTY_READING: ReadingRef = {
  textbook_id: null,
  chapters: [],
  page_ranges: [],
  explicit_pages: null,
  description: null,
};

const MAJOR_KINDS: ReadonlySet<ItemKind> = new Set(['exam', 'paper', 'project', 'presentation']);

export function newItemForm(kind: ItemKind = 'homework'): ItemFormValues {
  return {
    title: '',
    kind,
    dueDate: null,
    dueTime: null,
    assignedDate: null,
    componentId: null,
    weightOverride: null,
    pointsPossible: null,
    estimatedMinutes: null,
    isMajor: MAJOR_KINDS.has(kind),
    highImpact: null,
    description: '',
    notes: '',
    reading: null,
  };
}

export function itemFormFrom(item: Item): ItemFormValues {
  return {
    title: item.title,
    kind: item.kind,
    dueDate: item.due_date,
    dueTime: item.due_time ? item.due_time.slice(0, 5) : null,
    assignedDate: item.assigned_date,
    componentId: item.component_id,
    weightOverride: item.weight_override === null ? null : Number(item.weight_override),
    pointsPossible: item.points_possible === null ? null : Number(item.points_possible),
    estimatedMinutes: item.estimated_minutes,
    isMajor: item.is_major,
    highImpact: item.high_impact_override,
    description: item.description ?? '',
    notes: item.notes ?? '',
    reading: item.reading,
  };
}

/** Kind changes nudge "major" to the usual answer until the student sets it themselves. */
export function withKind(values: ItemFormValues, kind: ItemKind): ItemFormValues {
  const wasDefault = values.isMajor === MAJOR_KINDS.has(values.kind);
  return { ...values, kind, isMajor: wasDefault ? MAJOR_KINDS.has(kind) : values.isMajor, reading: kind === 'reading' ? (values.reading ?? EMPTY_READING) : values.reading };
}

export interface ItemFormErrors {
  title: string | null;
  assignedDate: string | null;
}

export function validateItemForm(values: ItemFormValues): ItemFormErrors {
  return {
    title: values.title.trim() ? null : 'Give it a title',
    assignedDate: values.assignedDate && values.dueDate && values.assignedDate > values.dueDate ? 'After the due date' : null,
  };
}

function readingOrNull(reading: ReadingRef | null): ReadingRef | null {
  if (!reading) return null;
  const empty =
    reading.textbook_id === null &&
    reading.chapters.length === 0 &&
    reading.page_ranges.length === 0 &&
    reading.explicit_pages === null &&
    !reading.description?.trim();
  return empty ? null : { ...reading, description: reading.description?.trim() || null };
}

type ItemFields = Pick<
  RowPatch<'items'>,
  | 'title'
  | 'kind'
  | 'due_date'
  | 'due_time'
  | 'assigned_date'
  | 'component_id'
  | 'weight_override'
  | 'points_possible'
  | 'estimated_minutes'
  | 'is_major'
  | 'high_impact_override'
  | 'description'
  | 'notes'
  | 'reading'
>;

function toFields(values: ItemFormValues): ItemFields {
  return {
    title: values.title.trim(),
    kind: values.kind,
    due_date: values.dueDate,
    due_time: values.dueDate ? values.dueTime : null,
    assigned_date: values.assignedDate,
    component_id: values.componentId,
    weight_override: values.weightOverride,
    points_possible: values.pointsPossible,
    estimated_minutes: values.kind === 'reading' ? null : values.estimatedMinutes,
    is_major: values.isMajor,
    high_impact_override: values.highImpact,
    description: values.description.trim() || null,
    notes: values.notes.trim() || null,
    reading: readingOrNull(values.reading),
  };
}

export function toNewItem(values: ItemFormValues, courseId: string): NewRow<'items'> {
  return { ...toFields(values), title: values.title.trim(), course_id: courseId, source: 'manual', status: 'todo' };
}

/** Only the fields that changed (an untouched save writes nothing and skips the replan). */
export function toItemPatch(values: ItemFormValues, item: Item): RowPatch<'items'> {
  const next = toFields(values);
  const before = toFields(itemFormFrom(item));
  const patch: RowPatch<'items'> = {};
  for (const key of Object.keys(next) as (keyof ItemFields)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key])) Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}
