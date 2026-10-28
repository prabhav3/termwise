// jsonb columns hold whatever was written: RLS lets an owner store any JSON, and a shared
// timeline import copies a classmate's values. Rows are reshaped to their declared types on read
// so one malformed value can't crash the planner (buildPlan) or a screen.
import type { Chapter, Course, CoursePolicies, GradeCutoff, Item, PageRange, ReadingRef, Textbook } from '@/types/db';

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

/** A finite number, or a numeric string ("90") as its number. */
function numericOrNull(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() !== '') return numberOrNull(Number(value));
  return numberOrNull(value);
}

/** courses.grade_scale: the cutoffs with a letter and a finite minimum percent, else []. */
export function normalizeGradeScale(value: unknown): GradeCutoff[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): GradeCutoff[] => {
    if (!isRecord(entry)) return [];
    const letter = stringOrNull(entry.letter)?.trim();
    const min = numericOrNull(entry.min);
    return letter && min !== null ? [{ letter, min }] : [];
  });
}

const POLICY_TEXT_KEYS = ['late_policy', 'attendance_policy', 'drop_policy', 'extra_credit'] as const;

/** courses.policies: {} unless it is an object; only well-typed fields are kept (all are optional). */
export function normalizePolicies(value: unknown): CoursePolicies {
  if (!isRecord(value)) return {};
  const policies: CoursePolicies = {};
  for (const key of POLICY_TEXT_KEYS) {
    const text = value[key];
    if (typeof text === 'string' || text === null) policies[key] = text;
  }
  if (typeof value.unannounced_quizzes === 'boolean') policies.unannounced_quizzes = value.unannounced_quizzes;
  return policies;
}

export function normalizeCourseRow<T extends Pick<Course, 'grade_scale' | 'policies'>>(course: T): T {
  return { ...course, grade_scale: normalizeGradeScale(course.grade_scale), policies: normalizePolicies(course.policies) };
}

export function normalizeItemRow<T extends Pick<Item, 'reading'>>(item: T): T {
  return { ...item, reading: normalizeReading(item.reading) };
}

export function normalizeTextbookRow<T extends Pick<Textbook, 'chapters'>>(book: T): T {
  return { ...book, chapters: normalizeChapters(book.chapters) };
}
