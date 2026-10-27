// The AI extraction contract, shared by the parse-syllabus edge function (Deno) and the app's
// review screen (Metro). Keep this file dependency-free apart from `zod` and free of Deno or
// React Native APIs, with no relative imports, so both runtimes can load it unchanged.
//
// Shape rules (so it maps onto Claude structured outputs without surprises):
//   * every field is required; "unknown" is expressed as `null`, never by omitting the key
//   * dates are `YYYY-MM-DD` strings, times are 24h `HH:MM` strings
//   * no numeric/string length constraints in the schema itself; `normalizeExtraction`
//     enforces ranges after parsing

import { z } from 'zod';

export const EXTRACTION_ITEM_KINDS = [
  'exam',
  'quiz',
  'paper',
  'project',
  'homework',
  'reading',
  'presentation',
  'lab',
  'discussion',
  'other',
] as const;

export const TERM_EVENT_KINDS = ['holiday', 'break', 'no_class', 'finals_period', 'add_drop', 'other'] as const;

export const WARNING_KINDS = [
  'ambiguous_date',
  'missing_weight',
  'weights_dont_sum',
  'unresolved_reading',
  'tbd_date',
  'conflict',
  'low_quality_scan',
  'other',
] as const;

export const ExtractedChapter = z.object({
  number: z.string().describe('Chapter identifier as printed, e.g. "4", "4A", "Appendix B"'),
  title: z.string().nullable(),
  start_page: z.number().int().nullable(),
  end_page: z.number().int().nullable(),
});

export const ExtractedTextbook = z.object({
  title: z.string(),
  authors: z.string().nullable(),
  edition: z.string().nullable(),
  chapters: z
    .array(ExtractedChapter)
    .describe('Chapter page map if the document lists one (a table of contents photo always does)'),
});

export const ExtractedReading = z.object({
  textbook_title: z.string().nullable().describe('Which textbook, matching textbooks[].title when possible'),
  chapters: z.array(z.string()).describe('Every chapter assigned, ranges expanded: "Ch. 4-7" -> ["4","5","6","7"]'),
  page_ranges: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
  explicit_pages: z.number().int().nullable().describe('Total pages only if the syllabus states it or it is computable from page ranges'),
  description: z.string().nullable().describe('Non-textbook readings, e.g. "Miller (1956) article"'),
});

export const ExtractedItem = z.object({
  title: z.string().describe('Short student-facing title, e.g. "Psych Quiz 1", "Research Paper Draft"'),
  kind: z.enum(EXTRACTION_ITEM_KINDS),
  due_date: z.string().nullable().describe('Resolved YYYY-MM-DD; null if TBD or unresolvable'),
  due_time: z.string().nullable().describe('24h HH:MM if stated'),
  date_text: z.string().nullable().describe('The original date wording, e.g. "Week 5, Tuesday"'),
  assigned_date: z.string().nullable().describe('YYYY-MM-DD when assigned/available, if known'),
  component_name: z.string().nullable().describe('Exact name of the grading_components entry this counts toward'),
  weight_percent: z.number().nullable().describe('Percent of final course grade for THIS item only, if stated or derivable'),
  points_possible: z.number().nullable(),
  is_major: z.boolean().describe('Exams, papers, projects, presentations, or anything worth >= 10% of the grade'),
  estimated_minutes: z.number().int().nullable().describe('Rough work time for non-reading items'),
  reading: ExtractedReading.nullable(),
  description: z.string().nullable(),
  source_quote: z.string().nullable().describe('Short verbatim snippet (<= 160 chars) the item came from'),
  confidence: z.number().describe('0-1 confidence in the date and details'),
});

export const ExtractedComponent = z.object({
  name: z.string().describe('e.g. "Quizzes", "Midterm Exam", "Participation"'),
  weight_percent: z.number().describe('Percent of the course grade, 0-100'),
  expected_count: z.number().int().nullable(),
  drop_lowest: z.number().int().describe('How many lowest scores are dropped; 0 if none'),
  notes: z.string().nullable(),
  confidence: z.number(),
});

export const ExtractedTermEvent = z.object({
  title: z.string(),
  kind: z.enum(TERM_EVENT_KINDS),
  start_date: z.string(),
  end_date: z.string(),
});

export const ExtractedWarning = z.object({
  kind: z.enum(WARNING_KINDS),
  message: z.string().describe('One sentence the student can act on'),
  related_item_title: z.string().nullable(),
});

export const SyllabusExtraction = z.object({
  course: z.object({
    title: z.string(),
    code: z.string().nullable(),
    section: z.string().nullable(),
    instructor: z.string().nullable(),
    instructor_email: z.string().nullable(),
    term_name: z.string().nullable(),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    meeting_days: z.array(z.number().int()).describe('0=Sunday ... 6=Saturday'),
    meeting_start: z.string().nullable(),
    meeting_end: z.string().nullable(),
    location: z.string().nullable(),
    credits: z.number().nullable(),
  }),
  grading_components: z.array(ExtractedComponent),
  grade_scale: z.array(z.object({ letter: z.string(), min_percent: z.number() })),
  items: z.array(ExtractedItem),
  term_events: z.array(ExtractedTermEvent),
  textbooks: z.array(ExtractedTextbook),
  policies: z.object({
    late_policy: z.string().nullable(),
    unannounced_quizzes: z.boolean().describe('Syllabus mentions pop / unannounced / surprise quizzes'),
    attendance_policy: z.string().nullable(),
    drop_policy: z.string().nullable(),
    extra_credit: z.string().nullable(),
  }),
  warnings: z.array(ExtractedWarning),
});

export const TocExtraction = z.object({
  textbook: ExtractedTextbook,
  warnings: z.array(ExtractedWarning),
});

export type ExtractedChapter = z.infer<typeof ExtractedChapter>;
export type ExtractedTextbook = z.infer<typeof ExtractedTextbook>;
export type ExtractedReading = z.infer<typeof ExtractedReading>;
export type ExtractedItem = z.infer<typeof ExtractedItem>;
export type ExtractedComponent = z.infer<typeof ExtractedComponent>;
export type ExtractedTermEvent = z.infer<typeof ExtractedTermEvent>;
export type ExtractedWarning = z.infer<typeof ExtractedWarning>;
export type SyllabusExtraction = z.infer<typeof SyllabusExtraction>;
export type TocExtraction = z.infer<typeof TocExtraction>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isISOTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Post-parse cleanup applied by the edge function before storing and by the app before import:
 * invalid dates/times become null (with a warning), numbers are clamped to sane ranges,
 * meeting days are deduped, and grading weights that don't sum to ~100 get a warning.
 */
export function normalizeExtraction(input: SyllabusExtraction): SyllabusExtraction {
  const warnings: ExtractedWarning[] = [...input.warnings];
  const date = (v: string | null, label: string): string | null => {
    if (v == null) return null;
    if (isISODate(v)) return v;
    warnings.push({ kind: 'ambiguous_date', message: `Couldn't read the date "${v}" for ${label}.`, related_item_title: label });
    return null;
  };
  const time = (v: string | null): string | null => (v != null && isISOTime(v) ? v.slice(0, 5) : null);

  const items = input.items.map((it) => ({
    ...it,
    due_date: date(it.due_date, it.title),
    assigned_date: it.assigned_date && isISODate(it.assigned_date) ? it.assigned_date : null,
    due_time: time(it.due_time),
    weight_percent: it.weight_percent == null ? null : clamp(it.weight_percent, 0, 100),
    points_possible: it.points_possible == null ? null : Math.max(0, it.points_possible),
    estimated_minutes: it.estimated_minutes == null ? null : clamp(Math.round(it.estimated_minutes), 0, 6000),
    confidence: clamp(it.confidence, 0, 1),
    source_quote: it.source_quote ? it.source_quote.slice(0, 280) : null,
    reading: it.reading
      ? {
          ...it.reading,
          page_ranges: it.reading.page_ranges.filter((r) => r.start > 0 && r.end >= r.start),
          explicit_pages: it.reading.explicit_pages == null ? null : Math.max(0, it.reading.explicit_pages),
        }
      : null,
  }));

  const grading_components = input.grading_components.map((c) => ({
    ...c,
    weight_percent: clamp(c.weight_percent, 0, 100),
    drop_lowest: Math.max(0, Math.round(c.drop_lowest)),
    expected_count: c.expected_count == null ? null : Math.max(0, Math.round(c.expected_count)),
    confidence: clamp(c.confidence, 0, 1),
  }));

  const total = grading_components.reduce((s, c) => s + c.weight_percent, 0);
  if (grading_components.length > 0 && Math.abs(total - 100) > 1 && !warnings.some((w) => w.kind === 'weights_dont_sum')) {
    warnings.push({
      kind: 'weights_dont_sum',
      message: `Grading weights add up to ${Math.round(total * 10) / 10}%, not 100%. Check the breakdown.`,
      related_item_title: null,
    });
  }

  const term_events = input.term_events.filter((e) => isISODate(e.start_date) && isISODate(e.end_date));

  return {
    ...input,
    course: {
      ...input.course,
      start_date: input.course.start_date && isISODate(input.course.start_date) ? input.course.start_date : null,
      end_date: input.course.end_date && isISODate(input.course.end_date) ? input.course.end_date : null,
      meeting_days: [...new Set(input.course.meeting_days.filter((d) => d >= 0 && d <= 6))].sort(),
      meeting_start: time(input.course.meeting_start),
      meeting_end: time(input.course.meeting_end),
    },
    grading_components,
    grade_scale: input.grade_scale
      .map((g) => ({ ...g, min_percent: clamp(g.min_percent, 0, 100) }))
      .sort((a, b) => b.min_percent - a.min_percent),
    items,
    term_events,
    warnings,
  };
}
