// jsonb columns hold whatever was written: RLS lets an owner store any JSON, and a shared
// timeline import copies a classmate's values. Rows are reshaped to their declared types on read
// so one malformed value can't crash the planner (buildPlan) or a screen.
import type { Chapter, Item, PageRange, ReadingRef, Textbook } from '@/types/db';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Chapter labels are strings ("4", "A"); a bare number is accepted as its text. */
function labelOrNull(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : stringOrNull(value);
}

function pageRange(value: unknown): PageRange[] {
  if (!isRecord(value)) return [];
  const start = numberOrNull(value.start);
  const end = numberOrNull(value.end);
  return start === null || end === null ? [] : [{ start, end }];
}

/** items.reading: null unless it is an object; missing or mistyped fields get their empty value. */
export function normalizeReading(value: unknown): ReadingRef | null {
  if (!isRecord(value)) return null;
  return {
    textbook_id: stringOrNull(value.textbook_id),
    chapters: Array.isArray(value.chapters) ? value.chapters.flatMap((chapter) => labelOrNull(chapter) ?? []) : [],
    page_ranges: Array.isArray(value.page_ranges) ? value.page_ranges.flatMap(pageRange) : [],
    explicit_pages: numberOrNull(value.explicit_pages),
    description: stringOrNull(value.description),
  };
}

/** textbooks.chapters: the well-formed entries (each needs a chapter number), else []. */
export function normalizeChapters(value: unknown): Chapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Chapter[] => {
    if (!isRecord(entry)) return [];
    const number = labelOrNull(entry.number);
    if (number === null) return [];
    return [
      {
        number,
        title: stringOrNull(entry.title),
        start_page: numberOrNull(entry.start_page),
        end_page: numberOrNull(entry.end_page),
      },
    ];
  });
}

export function normalizeItemRow<T extends Pick<Item, 'reading'>>(item: T): T {
  return { ...item, reading: normalizeReading(item.reading) };
}

export function normalizeTextbookRow<T extends Pick<Textbook, 'chapters'>>(book: T): T {
  return { ...book, chapters: normalizeChapters(book.chapters) };
}
