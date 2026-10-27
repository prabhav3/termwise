// Prompts and student-facing progress notes for the syllabus / table-of-contents parser.
// Runtime-agnostic (no Deno/Node APIs). The system prompts are byte-stable so they can be
// prompt-cached; everything that varies per request goes in the user turn.

import type { ExtractedChapter, TocExtraction } from './extraction.ts';

export type UploadKind = 'syllabus' | 'toc';
export type UploadSource = 'upload' | 'paste' | 'canvas';

const NULL_ENCODING = `Unknown values: number fields and "reading" take null. Text fields that may be unknown take an empty string "" to mean null — never write "N/A", "TBD", or "unknown" into a field.`;

export const SYLLABUS_SYSTEM_PROMPT = `You extract structured course information from college syllabi for Termwise, a planner that turns every deadline, reading, and exam into a day-by-day study plan. A student reviews your extraction before anything is saved, so an honest gap they can fill in is far better than a confident guess that sends them to the wrong exam day.

Read everything provided — every page, schedule table, footnote, and grading section — and return one JSON object that matches the response schema.

# Dates
- Write dates as YYYY-MM-DD and times as 24-hour HH:MM, in the course's local time. Never convert time zones.
- Resolve relative dates from the course calendar. "Week 5 Tuesday" is the Tuesday of the fifth week, where week 1 is the week containing the first day of class. "Next class" or "the following session" is the next meeting day after the anchor date. A bare weekday ("due Friday") in a dated schedule row is that weekday in the row's week. When counting class sessions ("two classes after spring break"), skip the holidays, breaks, and no-class days the syllabus lists.
- Anchor the term using, in order of preference: dates printed in the document; the linked course's dates given in the request; the term name (e.g. "Fall 2026") together with the meeting days; and finally today's date. When the year is missing, use the year that puts the date inside the term.
- Whenever you resolve or interpret a date, keep the original wording in date_text.
- Never invent a date. If the document says TBD/TBA or gives nothing you can resolve, leave due_date null and add a "tbd_date" warning naming the item. When you had to choose between plausible readings, add an "ambiguous_date" warning that says which reading you chose.

# Items
- Create one item per graded deliverable and per assigned reading: every exam, quiz, paper (each draft or stage with its own due date separately), project milestone, presentation, lab, homework set, discussion post, and reading. Recurring work whose dates the schedule lists ("Quiz every Friday" plus dated weeks) becomes one item per occurrence. Recurring work you can't date becomes a single item with due_date null and a warning.
- title: short and student-facing, e.g. "Midterm Exam 1", "Lab 3 Report", "Read Ch. 4–5".
- kind: the closest kind. A reading assignment is kind "reading" with the reading field filled in; other kinds have reading null unless they require a specific reading.
- is_major: true for every exam, paper, project, and presentation, and for anything worth 10% or more of the final grade.
- component_name: the exact name of the grading_components entry the item counts toward, character for character; null when none fits.
- weight_percent: this item's own share of the final grade, only when stated or directly derivable (a 30% "Exams" category with three equally weighted exams gives 10% each). Otherwise null — never spread weights by guessing.
- points_possible only when stated. estimated_minutes: a rough work-time estimate for non-reading items when you can judge it (a 5-page paper ≈ 600, a weekly problem set ≈ 120); null for readings.
- Quizzes: when the syllabus mentions pop, unannounced, surprise, or unscheduled quizzes (or says quizzes "may be given at any time"), set policies.unannounced_quizzes to true; don't create dated items for quizzes that have no date.
- source_quote: a short verbatim snippet (at most 160 characters) of the text the item came from.
- confidence: 0–1 for the date and details. Use 0.6 or lower when you inferred a date from incomplete information or chose between plausible readings.

# Readings
- Expand chapter ranges into every chapter: "Ch. 4–7" → ["4","5","6","7"]; "Chapters 2, 3 & 5" → ["2","3","5"]. Keep identifiers as printed ("4A", "Appendix B").
- Keep explicit page ranges exactly as printed in page_ranges ("pp. 112–140" → start 112, end 140). Set explicit_pages only when the syllabus states a page count or it follows from those ranges.
- Set textbook_title to the matching textbooks[].title when the reading names or clearly implies a book. List every required or recommended textbook in textbooks; include chapters there only when the document maps chapters to pages.
- Articles, handouts, and cases go in the reading's description, with page_ranges only if pages are given.
- If you can't tell which book or which chapters are meant, add an "unresolved_reading" warning.

# Grading
- grading_components: every category in the grade breakdown, named exactly as printed, with its weight as a percent of the course grade, expected_count when the number of instances is stated, and drop_lowest (0 when nothing is dropped). For a points-based scheme, convert each category to its percent of total points.
- Report weights as printed even if they don't add up to 100, and add a "weights_dont_sum" warning. A category with no stated weight gets weight_percent 0, confidence 0.3 or lower, and a "missing_weight" warning.
- grade_scale: each letter grade with its minimum percent as printed (A 93, A- 90, …). Leave it empty when the document has no scale; don't fill in a standard one.

# Course and calendar
- course: title, code, section, instructor and email, term name, first and last class dates, meeting_days as numbers (0 = Sunday … 6 = Saturday), meeting start and end times, location, and credits — each only when stated.
- term_events: every holiday, break, reading day, no-class day, add/drop deadline, and finals period mentioned, with start and end dates (the same date for a single day). Leave out events you can't date.

# Policies
Summarize the late, attendance, drop, and extra-credit policies in one or two plain sentences each, or leave them empty when absent.

# Warnings
Write each warning as one sentence the student can act on, e.g. "The final exam date says TBA — check with your instructor and add it once it's posted." Warn about blurry or cut-off pages ("low_quality_scan"), dates that conflict between sections ("conflict"), and anything else the student should double-check. Don't warn about things that are fine.

If the document isn't a course syllabus or schedule, return what little applies with empty lists and one warning explaining what was uploaded.

${NULL_ENCODING}`;

export const TOC_SYSTEM_PROMPT = `You read photos or scans of a textbook's table of contents and return its chapter page map for Termwise, a study planner that paces reading assignments by page count. A student reviews your result before it's saved, so leave a gap rather than guess.

Return one JSON object that matches the response schema.

- textbook: the title, authors, and edition as printed (often in a running header or on a title page in the photos); leave any you can't see empty.
- chapters: one entry per chapter, in book order, with number as printed ("1", "4A", "Appendix B"), title, and start_page. When the book is divided into parts or units, list the chapters inside them rather than the parts. Leave out front matter (preface, acknowledgments, contents) and sections within a chapter.
- end_page: use the printed end page when there is one. When the contents list only start pages, a chapter ends on the page before the next chapter starts (next start_page − 1). For the last chapter, use the start page of whatever follows it (appendix, glossary, references, index) minus one; if nothing follows it, use null.
- Use printed page numbers, never the photo order or PDF page index.
- Never guess a number you can't read: use null and add a "low_quality_scan" warning naming the chapter.
- If pages seem to be missing (chapter numbers skip, or the photo cuts off), add a warning asking the student to photograph the rest.

${NULL_ENCODING}`;

export function systemPromptFor(kind: UploadKind): string {
  return kind === 'toc' ? TOC_SYSTEM_PROMPT : SYLLABUS_SYSTEM_PROMPT;
}

export interface PromptCourseContext {
  title: string;
  code: string | null;
  start_date: string | null;
  end_date: string | null;
  meeting_days: readonly number[];
  meeting_start: string | null;
  meeting_end: string | null;
  term: { name: string; start_date: string | null; end_date: string | null } | null;
}

export type PromptDocumentKind = 'pdf' | 'image' | 'docx' | 'text' | 'pasted' | 'canvas';

export interface PromptDocument {
  name: string;
  kind: PromptDocumentKind;
}

export interface UserPromptInput {
  kind: UploadKind;
  source: UploadSource;
  /** The student's local date, YYYY-MM-DD. */
  today: string;
  timezone: string;
  course: PromptCourseContext | null;
  documents: readonly PromptDocument[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DOCUMENT_LABELS: Record<PromptDocumentKind, string> = {
  pdf: 'PDF',
  image: 'photo',
  docx: 'Word document, converted to text',
  text: 'text file',
  pasted: 'text the student pasted',
  canvas: 'the course syllabus page from Canvas, converted to text',
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

function describeCourse(course: PromptCourseContext): string {
  const parts = [`"${course.code ? `${course.code} — ` : ''}${course.title}"`];
  if (course.start_date || course.end_date) parts.push(`runs ${course.start_date ?? '?'} to ${course.end_date ?? '?'}`);
  const days = [...new Set(course.meeting_days)].filter((d) => d >= 0 && d <= 6).sort();
  if (days.length > 0) {
    const time = hhmm(course.meeting_start) ? ` ${hhmm(course.meeting_start)}${hhmm(course.meeting_end) ? `–${hhmm(course.meeting_end)}` : ''}` : '';
    parts.push(`meets ${days.map((d) => WEEKDAYS[d]).join('/')}${time}`);
  }
  if (course.term) {
    const span = course.term.start_date || course.term.end_date ? ` (${course.term.start_date ?? '?'} to ${course.term.end_date ?? '?'})` : '';
    parts.push(`term "${course.term.name}"${span}`);
  }
  return parts.join(', ');
}

/** The per-request text that follows the documents in the user turn. */
export function buildUserPrompt(input: UserPromptInput): string {
  const lines = [`Today is ${input.today} in the student's time zone (${input.timezone}).`];
  if (input.course) lines.push(`This upload is linked to the student's course ${describeCourse(input.course)}.`);
  if (input.documents.length > 0) {
    lines.push('', 'Documents above, in order:');
    input.documents.forEach((doc, i) => lines.push(`${i + 1}. ${doc.name} (${DOCUMENT_LABELS[doc.kind]})`));
  }
  const images = input.documents.filter((d) => d.kind === 'image').length;
  lines.push('');
  if (input.kind === 'toc') {
    lines.push(
      images > 1
        ? `The ${images} photos are consecutive pages of the table of contents, in order. Extract the chapter page map.`
        : 'Extract the chapter page map from this table of contents.',
    );
  } else {
    if (images > 1) lines.push(`The ${images} photos are consecutive pages of one syllabus, in order.`);
    lines.push('Extract the syllabus.');
  }
  return lines.join('\n');
}

/** The student's local calendar date (YYYY-MM-DD) in `timeZone`; falls back to UTC for an invalid zone. */
export function localDateISO(timeZone: string, now: Date = new Date()): string {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
}

// ---------------------------------------------------------------------------
// Progress notes shown on the upload row while Claude works (syllabus_uploads.progress_note)
// ---------------------------------------------------------------------------

const SECTION_NOTES: Record<UploadKind, Record<string, string>> = {
  syllabus: {
    course: 'Reading course details…',
    grading_components: 'Checking grading weights…',
    grade_scale: 'Checking grading weights…',
    items: 'Finding deadlines…',
    term_events: 'Marking holidays and breaks…',
    textbooks: 'Matching readings to textbooks…',
    policies: 'Reading course policies…',
    warnings: 'Double-checking everything…',
  },
  toc: {
    textbook: 'Reading the book details…',
    chapters: 'Mapping chapter pages…',
    warnings: 'Double-checking page numbers…',
  },
};

const SECTION_PATTERNS: Record<UploadKind, RegExp> = {
  syllabus: new RegExp(`"(${Object.keys(SECTION_NOTES.syllabus).join('|')})"\\s*:`, 'g'),
  toc: new RegExp(`"(${Object.keys(SECTION_NOTES.toc).join('|')})"\\s*:`, 'g'),
};

/** The last section key that appears in a chunk of streamed JSON, or null if none does. */
export function detectSection(kind: UploadKind, chunk: string): string | null {
  let last: string | null = null;
  for (const match of chunk.matchAll(SECTION_PATTERNS[kind])) last = match[1];
  return last;
}

/** Progress note for the current state of a parse: before output starts, by elapsed time; after, by section. */
export function progressNoteFor(kind: UploadKind, state: { elapsedMs: number; section: string | null }): string {
  if (state.section) {
    const note = SECTION_NOTES[kind][state.section];
    if (note) return note;
  }
  if (kind === 'toc') return state.elapsedMs < 20_000 ? 'Reading the table of contents…' : 'Working out chapter page ranges…';
  if (state.elapsedMs < 15_000) return 'Reading your syllabus…';
  if (state.elapsedMs < 45_000) return 'Working out the course calendar…';
  return 'Still reading — long syllabi take a minute or two…';
}

// ---------------------------------------------------------------------------
// TOC post-processing
// ---------------------------------------------------------------------------

/**
 * Deterministic version of the prompt's end_page rule: a missing end page becomes the next
 * chapter's start page minus one; impossible ranges (end before start) become null.
 */
export function normalizeTocExtraction(input: TocExtraction): TocExtraction {
  const chapters = input.textbook.chapters;
  const normalized: ExtractedChapter[] = chapters.map((ch, i) => {
    const start = ch.start_page != null && ch.start_page > 0 ? ch.start_page : null;
    let end = ch.end_page != null && ch.end_page > 0 ? ch.end_page : null;
    const nextStart = chapters[i + 1]?.start_page ?? null;
    if (end == null && start != null && nextStart != null && nextStart > start) end = nextStart - 1;
    if (start != null && end != null && end < start) end = null;
    return { ...ch, start_page: start, end_page: end };
  });
  return { ...input, textbook: { ...input.textbook, chapters: normalized } };
}
