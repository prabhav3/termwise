// The editable review draft: the AI extraction plus a stable key on every list entry, so rows
// keep their identity while the student edits, reorders, adds and deletes.
import { randomUUID } from 'expo-crypto';

import type {
  ExtractedItem,
  ExtractedTermEvent,
  ExtractedWarning,
  SyllabusExtraction,
} from '@shared/extraction.ts';

import { fromChapterRows, toChapterRows, type ChapterRow } from '@/components/courses/ChapterMapEditor';
import type { ScaleRow } from '@/components/courses/GradeScaleEditor';
import type { GradingRow } from '@/components/courses/GradingEditor';
import { startOfWeekISO, diffDaysISO, formatShortDate } from '@/lib/dates';

export type DraftItem = ExtractedItem & { key: string };
export type DraftEvent = ExtractedTermEvent & { key: string };
export type DraftWarning = ExtractedWarning & { key: string };
export type DraftComponent = GradingRow & { notes: string | null };
export interface DraftTextbook {
  key: string;
  title: string;
  authors: string | null;
  edition: string | null;
  chapters: ChapterRow[];
}

export interface ReviewDraft {
  course: SyllabusExtraction['course'];
  grading: DraftComponent[];
  scale: ScaleRow[];
  items: DraftItem[];
  events: DraftEvent[];
  textbooks: DraftTextbook[];
  policies: SyllabusExtraction['policies'];
  warnings: DraftWarning[];
}

export const LOW_CONFIDENCE = 0.7;

export function toDraft(extraction: SyllabusExtraction): ReviewDraft {
  return {
    course: extraction.course,
    grading: extraction.grading_components.map((component) => ({
      key: randomUUID(),
      name: component.name,
      weight: component.weight_percent,
      expected_count: component.expected_count,
      drop_lowest: component.drop_lowest,
      confidence: component.confidence,
      notes: component.notes,
    })),
    scale: extraction.grade_scale.map((cutoff) => ({ key: randomUUID(), letter: cutoff.letter, min: cutoff.min_percent })),
    items: extraction.items.map((item) => ({ ...item, key: randomUUID() })),
    events: extraction.term_events.map((event) => ({ ...event, key: randomUUID() })),
    textbooks: extraction.textbooks.map((book) => ({
      key: randomUUID(),
      title: book.title,
      authors: book.authors,
      edition: book.edition,
      chapters: toChapterRows(book.chapters),
    })),
    policies: extraction.policies,
    warnings: extraction.warnings.map((warning) => ({ ...warning, key: randomUUID() })),
  };
}

const strip = <T extends { key: string }>({ key: _key, ...rest }: T): Omit<T, 'key'> => rest;

export function fromDraft(draft: ReviewDraft): SyllabusExtraction {
  return {
    course: draft.course,
    grading_components: draft.grading
      .filter((row) => row.name.trim())
      .map((row) => ({
        name: row.name.trim(),
        weight_percent: row.weight ?? 0,
        expected_count: row.expected_count,
        drop_lowest: row.drop_lowest,
        notes: row.notes,
        confidence: row.confidence ?? 1,
      })),
    grade_scale: draft.scale
      .filter((row) => row.letter.trim() && row.min !== null)
      .map((row) => ({ letter: row.letter.trim(), min_percent: row.min ?? 0 })),
    items: draft.items.filter((item) => item.title.trim()).map(strip),
    term_events: draft.events.filter((event) => event.title.trim()).map(strip),
    textbooks: draft.textbooks
      .filter((book) => book.title.trim())
      .map((book) => ({ title: book.title.trim(), authors: book.authors, edition: book.edition, chapters: fromChapterRows(book.chapters) })),
    policies: draft.policies,
    warnings: draft.warnings.map(strip),
  };
}

export function newDraftItem(defaults: Partial<ExtractedItem> = {}): DraftItem {
  return {
    key: randomUUID(),
    title: '',
    kind: 'homework',
    due_date: null,
    due_time: null,
    date_text: null,
    assigned_date: null,
    component_name: null,
    weight_percent: null,
    points_possible: null,
    is_major: false,
    estimated_minutes: null,
    reading: null,
    description: null,
    source_quote: null,
    // Typed by the student: nothing to double-check.
    confidence: 1,
    ...defaults,
  };
}

export function newDraftEvent(start: string): DraftEvent {
  return { key: randomUUID(), title: '', kind: 'holiday', start_date: start, end_date: start };
}

export function newDraftTextbook(): DraftTextbook {
  return { key: randomUUID(), title: '', authors: null, edition: null, chapters: [] };
}

/** Renames a textbook and every reading that pointed at its old title. */
export function renameTextbook(draft: ReviewDraft, key: string, title: string): ReviewDraft {
  const book = draft.textbooks.find((b) => b.key === key);
  if (!book) return draft;
  const old = book.title;
  return {
    ...draft,
    textbooks: draft.textbooks.map((b) => (b.key === key ? { ...b, title } : b)),
    items: draft.items.map((item) =>
      item.reading && old && item.reading.textbook_title === old ? { ...item, reading: { ...item.reading, textbook_title: title } } : item,
    ),
  };
}

/** Renames a grading category and moves every item that counted toward it. */
export function renameComponents(draft: ReviewDraft, grading: DraftComponent[]): ReviewDraft {
  const renames = new Map<string, string>();
  for (const row of grading) {
    const before = draft.grading.find((old) => old.key === row.key);
    if (before && before.name !== row.name && before.name) renames.set(before.name, row.name);
  }
  const removed = new Set(draft.grading.filter((old) => !grading.some((row) => row.key === old.key)).map((old) => old.name));
  return {
    ...draft,
    grading,
    items: draft.items.map((item) => {
      if (!item.component_name) return item;
      if (renames.has(item.component_name)) return { ...item, component_name: renames.get(item.component_name) ?? null };
      if (removed.has(item.component_name)) return { ...item, component_name: null };
      return item;
    }),
  };
}

export interface WeekGroup {
  key: string;
  title: string;
  items: DraftItem[];
}

/**
 * Items by week (Monday-based) with "Week N" counted from the course start when known. Items
 * without a date come first: they are the ones that need attention.
 */
export function groupByWeek(items: readonly DraftItem[], courseStart: string | null): WeekGroup[] {
  const undated = items.filter((item) => !item.due_date);
  const dated = items
    .filter((item) => item.due_date)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || (a.due_time ?? '').localeCompare(b.due_time ?? ''));
  const groups: WeekGroup[] = [];
  if (undated.length > 0) groups.push({ key: 'undated', title: `Needs a date (${undated.length})`, items: undated });
  const firstWeek = courseStart ? startOfWeekISO(courseStart) : null;
  const byWeek = new Map<string, DraftItem[]>();
  for (const item of dated) {
    const week = startOfWeekISO(item.due_date ?? '');
    const list = byWeek.get(week) ?? [];
    list.push(item);
    byWeek.set(week, list);
  }
  for (const [week, list] of byWeek) {
    const number = firstWeek ? Math.floor(diffDaysISO(firstWeek, week) / 7) + 1 : null;
    const title = number !== null && number >= 1 ? `Week ${number} · ${formatShortDate(week)}` : `Week of ${formatShortDate(week)}`;
    groups.push({ key: week, title, items: list });
  }
  return groups;
}
