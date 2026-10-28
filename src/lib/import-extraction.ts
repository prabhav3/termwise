// Maps a reviewed AI extraction (supabase/functions/_shared/extraction.ts) onto database rows.
// Pure TypeScript: no React Native, no Supabase, no clock. Row ids are generated up front by the
// caller's `newId()` so components, textbooks and items can reference each other before anything
// is written, and the whole plan can be checked in vitest (import-extraction.test.ts).
//
// Merging into an existing course (the upload has course_id) only ever fills empty fields: the
// student's own edits, Canvas dates and scores are never overwritten.
import type {
  ExtractedChapter,
  ExtractedItem,
  ExtractedReading,
  ExtractedTextbook,
  SyllabusExtraction,
} from '@shared/extraction.ts';
import { matchCandidates, normalizeTitle, titleSimilarity, type MatchCandidate } from '@shared/match.ts';

import type { NewRow, RowPatch } from '@/data/database';
import { nextCourseColor } from '@/theme/tokens';
import type {
  Chapter,
  Course,
  CoursePolicies,
  GradeCutoff,
  GradingComponent,
  Item,
  PageRange,
  ReadingRef,
  Term,
  TermEvent,
  Textbook,
} from '@/types/db';

// ---- terms -------------------------------------------------------------------------------------

export type TermChoice =
  | { kind: 'existing'; termId: string }
  | { kind: 'new'; name: string; start_date: string | null; end_date: string | null }
  | { kind: 'none' };

/** "Fall 2026" from a course start date (Aug–Dec fall, Jan–May spring, Jun–Jul summer). */
export function deriveTermName(startDate: string | null): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const year = Number(startDate.slice(0, 4));
  const month = Number(startDate.slice(5, 7));
  const season = month >= 8 ? 'Fall' : month >= 6 ? 'Summer' : 'Spring';
  return `${season} ${year}`;
}

function sameName(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  return na.length > 0 && na === normalizeTitle(b);
}

function termContains(term: Term, date: string): boolean {
  return term.start_date !== null && term.end_date !== null && term.start_date <= date && date <= term.end_date;
}

/**
 * The term a freshly parsed course most likely belongs to: an existing term with the same name
 * or dates around the course start, else a new term named from the syllabus, else the active term.
 */
export function suggestTermChoice(draft: Pick<SyllabusExtraction, 'course'>, terms: readonly Term[]): TermChoice {
  const { term_name, start_date, end_date } = draft.course;
  const named = term_name ? terms.find((term) => sameName(term.name, term_name)) : undefined;
  if (named) return { kind: 'existing', termId: named.id };
  if (start_date) {
    const containing = terms.find((term) => termContains(term, start_date));
    if (containing) return { kind: 'existing', termId: containing.id };
  }
  const name = term_name?.trim() || deriveTermName(start_date);
  if (name) {
    const derived = terms.find((term) => sameName(term.name, name));
    if (derived) return { kind: 'existing', termId: derived.id };
    return { kind: 'new', name, start_date, end_date };
  }
  const active = terms.find((term) => term.is_active);
  return active ? { kind: 'existing', termId: active.id } : { kind: 'none' };
}

// ---- small text helpers shared with the review editors -------------------------------------------

/** "4, 5-7, Appendix B" -> ["4", "5", "6", "7", "Appendix B"]. Ranges over 60 chapters are kept literal. */
export function parseChapterList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().replace(/^(ch(apters?)?|chs?)\.?\s*/i, '');
    if (!part) continue;
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 60) {
        for (let n = start; n <= end; n++) out.push(String(n));
        continue;
      }
    }
    out.push(part);
  }
  return [...new Set(out)];
}

/** Compact form for editing: ["4","5","6","9"] -> "4–6, 9". */
export function formatChapterList(chapters: readonly string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < chapters.length) {
    const current = chapters[i];
    if (/^\d+$/.test(current)) {
      let j = i;
      while (j + 1 < chapters.length && /^\d+$/.test(chapters[j + 1]) && Number(chapters[j + 1]) === Number(chapters[j]) + 1) j++;
      parts.push(j - i >= 2 ? `${current}–${chapters[j]}` : chapters.slice(i, j + 1).join(', '));
      i = j + 1;
    } else {
      parts.push(current);
      i++;
    }
  }
  return parts.join(', ');
}

/** "101-126, 130" -> [{101,126},{130,130}]; invalid pieces are dropped. */
export function parsePageRanges(text: string): PageRange[] {
  const out: PageRange[] = [];
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().replace(/^pp?\.?\s*/i, '');
    if (!part) continue;
    const range = /^(\d+)\s*(?:[-–—]|to)\s*(\d+)$/i.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 0 && end >= start) out.push({ start, end });
      continue;
    }
    if (/^\d+$/.test(part) && Number(part) > 0) out.push({ start: Number(part), end: Number(part) });
  }
  return out;
}

export function formatPageRanges(ranges: readonly PageRange[]): string {
  return ranges.map((r) => (r.start === r.end ? String(r.start) : `${r.start}–${r.end}`)).join(', ');
}

/** Sum of grading weights, rounded to one decimal. */
export function totalWeight(components: readonly { weight_percent: number | null }[]): number {
  const sum = components.reduce((s, c) => s + (c.weight_percent ?? 0), 0);
  return Math.round(sum * 10) / 10;
}

/** Pages covered by a chapter map (chapters with both page numbers only). */
export function chapterMapPages(chapters: readonly Pick<Chapter, 'start_page' | 'end_page'>[]): number {
  return chapters.reduce(
    (sum, c) => (c.start_page !== null && c.end_page !== null && c.end_page >= c.start_page ? sum + c.end_page - c.start_page + 1 : sum),
    0,
  );
}

// ---- row mapping -----------------------------------------------------------------------------

type WithId<T> = T & { id: string };

export interface MergeTarget {
  course: Course;
  components: GradingComponent[];
  items: Item[];
  textbooks: Textbook[];
  termEvents: TermEvent[];
}

export interface ImportContext {
  /** The student's terms (to validate an existing-term choice). */
  terms: readonly Term[];
  /** How many courses the student already has (picks the next course color). */
  courseCount: number;
  /** The course this upload belongs to (syllabus_uploads.course_id), with its current rows. */
  target: MergeTarget | null;
  termChoice: TermChoice;
  /** Client-generated row ids (expo-crypto randomUUID in the app, a counter in tests). */
  newId: () => string;
}

export interface ImportPlan {
  courseId: string;
  termId: string | null;
  newTerm: WithId<NewRow<'terms'>> | null;
  /** Set when a new course is created. */
  newCourse: WithId<NewRow<'courses'>> | null;
  /** Gap-filling changes when merging into an existing course (null when nothing to fill). */
  courseChanges: RowPatch<'courses'> | null;
  components: { create: WithId<NewRow<'grading_components'>>[]; update: { id: string; changes: RowPatch<'grading_components'> }[] };
  textbooks: { create: WithId<NewRow<'textbooks'>>[]; update: { id: string; changes: RowPatch<'textbooks'> }[] };
  items: { create: WithId<NewRow<'items'>>[]; update: { id: string; changes: RowPatch<'items'> }[] };
  termEvents: { create: WithId<NewRow<'term_events'>>[] };
  summary: {
    itemsCreated: number;
    itemsMerged: number;
    componentsCreated: number;
    textbooksCreated: number;
    termEventsCreated: number;
  };
}

const blank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function toGradeScale(scale: SyllabusExtraction['grade_scale']): GradeCutoff[] {
  return scale
    .map((cutoff) => ({ letter: cutoff.letter.trim(), min: Math.min(100, Math.max(0, cutoff.min_percent)) }))
    .filter((cutoff) => cutoff.letter.length > 0)
    .sort((a, b) => b.min - a.min);
}

/** The column default from the migration: treated as "not customised" when merging. */
const DEFAULT_SCALE: readonly GradeCutoff[] = [
  { letter: 'A', min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B', min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C', min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D', min: 63 },
  { letter: 'D-', min: 60 },
  { letter: 'F', min: 0 },
];

function isDefaultScale(scale: readonly GradeCutoff[]): boolean {
  return (
    scale.length === 0 ||
    (scale.length === DEFAULT_SCALE.length &&
      scale.every((cutoff, i) => cutoff.letter === DEFAULT_SCALE[i].letter && Number(cutoff.min) === DEFAULT_SCALE[i].min))
  );
}

function toPolicies(policies: SyllabusExtraction['policies']): CoursePolicies {
  return {
    late_policy: blank(policies.late_policy),
    unannounced_quizzes: policies.unannounced_quizzes,
    attendance_policy: blank(policies.attendance_policy),
    drop_policy: blank(policies.drop_policy),
    extra_credit: blank(policies.extra_credit),
  };
}

function textbookTitle(book: ExtractedTextbook): string {
  const title = book.title.trim();
  const edition = blank(book.edition);
  return edition && !title.toLowerCase().includes(edition.toLowerCase()) ? `${title} (${edition})` : title;
}

function toChapters(chapters: readonly ExtractedChapter[]): Chapter[] {
  return chapters
    .map((c) => ({
      number: c.number.trim(),
      title: blank(c.title),
      start_page: c.start_page !== null && c.start_page > 0 ? Math.round(c.start_page) : null,
      end_page: c.end_page !== null && c.end_page > 0 ? Math.round(c.end_page) : null,
    }))
    .filter((c) => c.number.length > 0);
}

/** Best one-to-one name matches (similarity ≥ min), best first. */
function matchByName<A, B>(
  as: readonly A[],
  bs: readonly B[],
  nameA: (a: A) => string,
  nameB: (b: B) => string,
  min: number,
): Map<number, number> {
  const scored: { i: number; j: number; score: number }[] = [];
  as.forEach((a, i) => {
    bs.forEach((b, j) => {
      const score = sameName(nameA(a), nameB(b)) ? 1 : titleSimilarity(nameA(a), nameB(b));
      if (score >= min) scored.push({ i, j, score });
    });
  });
  scored.sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out = new Map<number, number>();
  for (const s of scored) {
    if (usedA.has(s.i) || usedB.has(s.j)) continue;
    usedA.add(s.i);
    usedB.add(s.j);
    out.set(s.i, s.j);
  }
  return out;
}

interface NamedRef {
  id: string;
  name: string;
}

/** Resolves a free-text reference ("Quizzes", "Myers Psychology") to one of `refs`. */
function resolveRef(name: string | null, refs: readonly NamedRef[], min: number): string | null {
  const wanted = blank(name);
  if (!wanted) return null;
  const exact = refs.find((ref) => sameName(ref.name, wanted));
  if (exact) return exact.id;
  let best: { id: string; score: number } | null = null;
  for (const ref of refs) {
    const score = titleSimilarity(wanted, ref.name);
    if (score >= min && (!best || score > best.score)) best = { id: ref.id, score };
  }
  return best?.id ?? null;
}

/** An item with no component_name still lands in "Quizzes" when it is the only quiz-like category. */
function componentForKind(kind: string, refs: readonly NamedRef[]): string | null {
  const hits = new Set(refs.filter((ref) => titleSimilarity(kind, ref.name) >= 0.99).map((ref) => ref.id));
  return hits.size === 1 ? [...hits][0] : null;
}

function toReading(reading: ExtractedReading | null, textbooks: readonly NamedRef[]): ReadingRef | null {
  if (!reading) return null;
  let textbookId = resolveRef(reading.textbook_title, textbooks, 0.6);
  // A single course textbook is the obvious home for "Ch. 4–5" with no title.
  if (!textbookId && !reading.textbook_title && reading.chapters.length > 0 && textbooks.length === 1) {
    textbookId = textbooks[0].id;
  }
  return {
    textbook_id: textbookId,
    chapters: reading.chapters.map((c) => c.trim()).filter(Boolean),
    page_ranges: reading.page_ranges.filter((r) => r.start > 0 && r.end >= r.start),
    explicit_pages: reading.explicit_pages !== null && reading.explicit_pages > 0 ? reading.explicit_pages : null,
    description: blank(reading.description),
  };
}

interface ComponentShare {
  id: string;
  weight: number;
  slots: number;
}

/**
 * The syllabus' per-item weight is kept as weight_override only when the item has no grading
 * component, or when it differs from the even split of its component (e.g. "Paper 1 10%, Paper 2
 * 20%"). Otherwise the engine derives it, which keeps drop-lowest and grades consistent.
 */
function weightOverride(stated: number | null, componentId: string | null, shares: ReadonlyMap<string, ComponentShare>): number | null {
  if (stated === null || !Number.isFinite(stated)) return null;
  const clamped = Math.min(100, Math.max(0, stated));
  if (componentId === null) return clamped;
  const share = shares.get(componentId);
  if (!share || share.slots <= 0) return clamped;
  return Math.abs(share.weight / share.slots - clamped) > 0.5 ? clamped : null;
}

function itemNotes(item: ExtractedItem): string | null {
  const dateText = blank(item.date_text);
  return item.due_date === null && dateText ? `Syllabus date: ${dateText}` : null;
}

function eventKey(e: { kind: string; start_date: string; end_date: string; title: string }): string {
  return `${e.kind}|${e.start_date}|${e.end_date}|${normalizeTitle(e.title)}`;
}

/** Turns a reviewed extraction into the rows to write. */
export function planImport(draft: SyllabusExtraction, ctx: ImportContext): ImportPlan {
  const target = ctx.target;

  // Term ----------------------------------------------------------------------------------------
  let termId: string | null = target?.course.term_id ?? null;
  let newTerm: ImportPlan['newTerm'] = null;
  if (termId === null) {
    const choice = ctx.termChoice;
    if (choice.kind === 'existing' && ctx.terms.some((term) => term.id === choice.termId)) {
      termId = choice.termId;
    } else if (choice.kind === 'new' && choice.name.trim()) {
      const start = choice.start_date;
      const end = choice.end_date;
      const ordered = start && end && start > end ? { start_date: end, end_date: start } : { start_date: start, end_date: end };
      newTerm = { id: ctx.newId(), name: choice.name.trim(), ...ordered, is_active: true };
      termId = newTerm.id;
    }
  }

  // Course --------------------------------------------------------------------------------------
  const info = draft.course;
  const scale = toGradeScale(draft.grade_scale);
  const policies = toPolicies(draft.policies);
  const meetingDays = [...new Set(info.meeting_days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  let courseId: string;
  let newCourse: ImportPlan['newCourse'] = null;
  let courseChanges: RowPatch<'courses'> | null = null;

  if (!target) {
    courseId = ctx.newId();
    const dates =
      info.start_date && info.end_date && info.start_date > info.end_date
        ? { start_date: info.end_date, end_date: info.start_date }
        : { start_date: info.start_date, end_date: info.end_date };
    newCourse = {
      id: courseId,
      term_id: termId,
      title: info.title.trim() || blank(info.code) || 'Untitled course',
      code: blank(info.code),
      section: blank(info.section),
      instructor: blank(info.instructor),
      instructor_email: blank(info.instructor_email),
      color: nextCourseColor(ctx.courseCount),
      credits: info.credits !== null && info.credits >= 0 ? info.credits : null,
      meeting_days: meetingDays,
      meeting_start: info.meeting_start,
      meeting_end: info.meeting_end,
      location: blank(info.location),
      ...dates,
      policies,
      ...(scale.length > 0 ? { grade_scale: scale } : {}),
    };
  } else {
    const course = target.course;
    courseId = course.id;
    const changes: RowPatch<'courses'> = {};
    const fillText = (key: 'code' | 'section' | 'instructor' | 'instructor_email' | 'location', value: string | null) => {
      const next = blank(value);
      if (blank(course[key]) === null && next !== null) changes[key] = next;
    };
    fillText('code', info.code);
    fillText('section', info.section);
    fillText('instructor', info.instructor);
    fillText('instructor_email', info.instructor_email);
    fillText('location', info.location);
    if (course.credits === null && info.credits !== null && info.credits >= 0) changes.credits = info.credits;
    if (course.start_date === null && info.start_date) changes.start_date = info.start_date;
    if (course.end_date === null && info.end_date) changes.end_date = info.end_date;
    if (course.meeting_start === null && info.meeting_start) changes.meeting_start = info.meeting_start;
    if (course.meeting_end === null && info.meeting_end) changes.meeting_end = info.meeting_end;
    if (course.meeting_days.length === 0 && meetingDays.length > 0) changes.meeting_days = meetingDays;
    if (course.term_id === null && termId !== null) changes.term_id = termId;
    if (scale.length > 0 && isDefaultScale(course.grade_scale)) changes.grade_scale = scale;
    const current = course.policies ?? {};
    const mergedPolicies: CoursePolicies = { ...current };
    let policiesChanged = false;
    for (const key of ['late_policy', 'attendance_policy', 'drop_policy', 'extra_credit'] as const) {
      if (blank(current[key]) === null && policies[key]) {
        mergedPolicies[key] = policies[key];
        policiesChanged = true;
      }
    }
    if (current.unannounced_quizzes === undefined && policies.unannounced_quizzes) {
      mergedPolicies.unannounced_quizzes = true;
      policiesChanged = true;
    }
    if (policiesChanged) changes.policies = mergedPolicies;
    courseChanges = Object.keys(changes).length > 0 ? changes : null;
  }

  // Grading components --------------------------------------------------------------------------
  const draftComponents = draft.grading_components.filter((c) => c.name.trim().length > 0);
  const componentRefs: NamedRef[] = [];
  const componentWeights = new Map<string, { weight: number; expected: number | null }>();
  const components: ImportPlan['components'] = { create: [], update: [] };
  const existingComponents = target?.components ?? [];
  const componentMatches = matchByName(draftComponents, existingComponents, (c) => c.name, (c) => c.name, 0.7);
  let sortOrder = existingComponents.reduce((max, c) => Math.max(max, c.sort_order + 1), 0);
  draftComponents.forEach((component, i) => {
    const matched = componentMatches.get(i);
    if (matched !== undefined) {
      const existing = existingComponents[matched];
      componentRefs.push({ id: existing.id, name: component.name }, { id: existing.id, name: existing.name });
      componentWeights.set(existing.id, { weight: Number(existing.weight), expected: existing.expected_count ?? component.expected_count });
      if (existing.expected_count === null && component.expected_count !== null) {
        components.update.push({ id: existing.id, changes: { expected_count: component.expected_count } });
      }
      return;
    }
    const id = ctx.newId();
    componentRefs.push({ id, name: component.name });
    componentWeights.set(id, { weight: component.weight_percent, expected: component.expected_count });
    components.create.push({
      id,
      course_id: courseId,
      name: component.name.trim(),
      weight: Math.min(100, Math.max(0, component.weight_percent)),
      expected_count: component.expected_count,
      drop_lowest: Math.max(0, Math.round(component.drop_lowest)),
      source: 'ai',
      sort_order: sortOrder++,
    });
  });
  for (const existing of existingComponents) {
    if (!componentRefs.some((ref) => ref.id === existing.id)) {
      componentRefs.push({ id: existing.id, name: existing.name });
      componentWeights.set(existing.id, { weight: Number(existing.weight), expected: existing.expected_count });
    }
  }

  // Textbooks -----------------------------------------------------------------------------------
  const draftBooks = draft.textbooks.filter((b) => b.title.trim().length > 0);
  const existingBooks = target?.textbooks ?? [];
  const bookMatches = matchByName(draftBooks, existingBooks, (b) => b.title, (b) => b.title, 0.7);
  const bookRefs: NamedRef[] = [];
  const textbooks: ImportPlan['textbooks'] = { create: [], update: [] };
  draftBooks.forEach((book, i) => {
    const chapters = toChapters(book.chapters);
    const matched = bookMatches.get(i);
    if (matched !== undefined) {
      const existing = existingBooks[matched];
      bookRefs.push({ id: existing.id, name: book.title }, { id: existing.id, name: existing.title });
      const changes: RowPatch<'textbooks'> = {};
      if (blank(existing.authors) === null && blank(book.authors)) changes.authors = blank(book.authors);
      const merged: Chapter[] = existing.chapters.map((chapter) => {
        const fresh = chapters.find((c) => c.number === chapter.number);
        if (!fresh) return chapter;
        return {
          number: chapter.number,
          title: chapter.title ?? fresh.title,
          start_page: chapter.start_page ?? fresh.start_page,
          end_page: chapter.end_page ?? fresh.end_page,
        };
      });
      for (const chapter of chapters) if (!merged.some((c) => c.number === chapter.number)) merged.push(chapter);
      if (JSON.stringify(merged) !== JSON.stringify(existing.chapters)) changes.chapters = merged;
      if (Object.keys(changes).length > 0) textbooks.update.push({ id: existing.id, changes });
      return;
    }
    const id = ctx.newId();
    bookRefs.push({ id, name: book.title });
    textbooks.create.push({ id, course_id: courseId, title: textbookTitle(book), authors: blank(book.authors), chapters });
  });
  for (const existing of existingBooks) {
    if (!bookRefs.some((ref) => ref.id === existing.id)) bookRefs.push({ id: existing.id, name: existing.title });
  }

  // Items ---------------------------------------------------------------------------------------
  const draftItems = draft.items.filter((item) => item.title.trim().length > 0);
  const resolvedComponent = draftItems.map(
    (item) => resolveRef(item.component_name, componentRefs, 0.6) ?? (item.component_name ? null : componentForKind(item.kind, componentRefs)),
  );

  // Slots per component = max(expected_count, items linked) — the engine's even split.
  const linkedCount = new Map<string, number>();
  resolvedComponent.forEach((id) => {
    if (id) linkedCount.set(id, (linkedCount.get(id) ?? 0) + 1);
  });
  for (const existing of target?.items ?? []) {
    if (existing.component_id) linkedCount.set(existing.component_id, (linkedCount.get(existing.component_id) ?? 0) + 1);
  }
  const shares = new Map<string, ComponentShare>();
  for (const [id, { weight, expected }] of componentWeights) {
    shares.set(id, { id, weight, slots: Math.max(expected ?? 0, linkedCount.get(id) ?? 0) });
  }

  const draftCandidates: (MatchCandidate & { index: number })[] = draftItems.map((item, index) => ({
    id: `draft:${index}`,
    index,
    title: item.title,
    kind: item.kind,
    date: item.due_date,
  }));
  const existingItems = target?.items ?? [];
  const existingCandidates: (MatchCandidate & { item: Item })[] = existingItems.map((item) => ({
    id: item.id,
    item,
    title: item.title,
    kind: item.kind,
    date: item.due_date,
  }));
  const { pairs } = matchCandidates(draftCandidates, existingCandidates);
  const matchedTo = new Map<number, Item>(pairs.map((pair) => [pair.a.index, pair.b.item]));

  const items: ImportPlan['items'] = { create: [], update: [] };
  draftItems.forEach((item, index) => {
    const componentId = resolvedComponent[index];
    const reading = toReading(item.reading, bookRefs);
    const override = weightOverride(item.weight_percent, componentId, shares);
    const existing = matchedTo.get(index);
    if (existing) {
      const changes: RowPatch<'items'> = {};
      if (existing.due_date === null && item.due_date) changes.due_date = item.due_date;
      if (existing.due_time === null && item.due_time && (existing.due_date === null || existing.due_date === item.due_date)) {
        changes.due_time = item.due_time;
      }
      if (existing.assigned_date === null && item.assigned_date) changes.assigned_date = item.assigned_date;
      if (existing.component_id === null && componentId) changes.component_id = componentId;
      if (existing.weight_override === null && override !== null && existing.component_id === null) changes.weight_override = override;
      if (existing.points_possible === null && item.points_possible !== null) changes.points_possible = item.points_possible;
      if (existing.estimated_minutes === null && item.estimated_minutes !== null) changes.estimated_minutes = item.estimated_minutes;
      if (existing.reading === null && reading) changes.reading = reading;
      if (blank(existing.description) === null && blank(item.description)) changes.description = blank(item.description);
      if (blank(existing.source_quote) === null && blank(item.source_quote)) changes.source_quote = blank(item.source_quote);
      if (Object.keys(changes).length > 0) items.update.push({ id: existing.id, changes });
      return;
    }
    items.create.push({
      id: ctx.newId(),
      course_id: courseId,
      component_id: componentId,
      title: item.title.trim(),
      kind: item.kind,
      description: blank(item.description),
      assigned_date: item.assigned_date,
      due_date: item.due_date,
      due_time: item.due_time,
      weight_override: override,
      points_possible: item.points_possible,
      estimated_minutes: item.estimated_minutes,
      reading,
      is_major: item.is_major,
      source: 'ai',
      confidence: item.confidence,
      source_quote: blank(item.source_quote),
      notes: itemNotes(item),
      status: 'todo',
    });
  });

  // Term events ---------------------------------------------------------------------------------
  const seen = new Set((target?.termEvents ?? []).map(eventKey));
  const termEvents: ImportPlan['termEvents'] = { create: [] };
  for (const event of draft.term_events) {
    if (!event.title.trim() || !event.start_date || !event.end_date) continue;
    const ordered =
      event.start_date > event.end_date
        ? { start_date: event.end_date, end_date: event.start_date }
        : { start_date: event.start_date, end_date: event.end_date };
    const row = { title: event.title.trim(), kind: event.kind, ...ordered };
    const key = eventKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    termEvents.create.push({ id: ctx.newId(), ...row, course_id: courseId, term_id: termId, source: 'ai' });
  }

  return {
    courseId,
    termId,
    newTerm,
    newCourse,
    courseChanges,
    components,
    textbooks,
    items,
    termEvents,
    summary: {
      itemsCreated: items.create.length,
      itemsMerged: pairs.length,
      componentsCreated: components.create.length,
      textbooksCreated: textbooks.create.length,
      termEventsCreated: termEvents.create.length,
    },
  };
}

// ---- table of contents ---------------------------------------------------------------------------

export interface TocPlan {
  create: WithId<NewRow<'textbooks'>> | null;
  update: { id: string; changes: RowPatch<'textbooks'> } | null;
  textbookId: string;
}

/**
 * A scanned table of contents becomes a new textbook, or replaces the chapter map of the book
 * the student chose (they reviewed every chapter; title and authors are only filled when empty).
 */
export function planTocImport(
  book: ExtractedTextbook,
  target: { courseId: string; existing: Textbook | null },
  newId: () => string,
): TocPlan {
  const chapters = toChapters(book.chapters);
  if (target.existing) {
    const existing = target.existing;
    const changes: RowPatch<'textbooks'> = { chapters };
    if (!existing.title.trim() && book.title.trim()) changes.title = textbookTitle(book);
    if (blank(existing.authors) === null && blank(book.authors)) changes.authors = blank(book.authors);
    return { create: null, update: { id: existing.id, changes }, textbookId: existing.id };
  }
  const id = newId();
  return {
    create: { id, course_id: target.courseId, title: textbookTitle(book) || 'Textbook', authors: blank(book.authors), chapters },
    update: null,
    textbookId: id,
  };
}
