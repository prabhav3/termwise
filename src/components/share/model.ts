// Pure helpers for the share-link import screen: what a classmate's snapshot holds, and which
// term the imported course most likely belongs to.
import type { TermSelection } from '@/components/courses/pickers';
import { deriveTermName } from '@/lib/import-extraction';
import type { ISODate, ItemKind, SharedSnapshot, Term } from '@/types/db';

export type SharedItem = SharedSnapshot['items'][number];

export type ShareCountKey = 'exams' | 'quizzes' | 'papers' | 'readings' | 'assignments';

export interface ShareCount {
  key: ShareCountKey;
  count: number;
  /** "3 exams" / "1 exam". */
  label: string;
}

export interface SnapshotSummary {
  /** Non-zero groups only, in a fixed order (exams first: what students scan for). */
  counts: ShareCount[];
  total: number;
  /** Items with a due date. */
  dated: number;
  /** The next dated items from `today` (or the first ones, when the course is already over). */
  next: SharedItem[];
  /** True when `next` lists items that are still ahead. */
  nextAreUpcoming: boolean;
  textbooks: number;
  termEvents: number;
}

const GROUP_OF: Record<ItemKind, ShareCountKey> = {
  exam: 'exams',
  quiz: 'quizzes',
  paper: 'papers',
  project: 'papers',
  presentation: 'papers',
  reading: 'readings',
  homework: 'assignments',
  lab: 'assignments',
  discussion: 'assignments',
  other: 'assignments',
};

const GROUP_ORDER: readonly ShareCountKey[] = ['exams', 'quizzes', 'papers', 'readings', 'assignments'];

const NOUNS: Record<ShareCountKey, [singular: string, plural: string]> = {
  exams: ['exam', 'exams'],
  quizzes: ['quiz', 'quizzes'],
  papers: ['paper or project', 'papers & projects'],
  readings: ['reading', 'readings'],
  assignments: ['assignment', 'assignments'],
};

export function countLabel(key: ShareCountKey, count: number): string {
  const [one, many] = NOUNS[key];
  return `${count} ${count === 1 ? one : many}`;
}

function groupOf(item: SharedItem): ShareCountKey {
  // A homework row that carries chapters to read still reads as a reading.
  if (item.kind !== 'exam' && item.kind !== 'quiz' && item.reading && GROUP_OF[item.kind] === 'assignments') return 'readings';
  return GROUP_OF[item.kind];
}

function byDue(a: SharedItem, b: SharedItem): number {
  const da = a.due_date ?? '';
  const db = b.due_date ?? '';
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.due_time ?? '99:99';
  const tb = b.due_time ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function summarizeSnapshot(snapshot: SharedSnapshot, today: ISODate, nextCount = 4): SnapshotSummary {
  const tally = new Map<ShareCountKey, number>();
  for (const item of snapshot.items) {
    const key = groupOf(item);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const counts = GROUP_ORDER.filter((key) => (tally.get(key) ?? 0) > 0).map((key) => {
    const count = tally.get(key) ?? 0;
    return { key, count, label: countLabel(key, count) };
  });

  const dated = snapshot.items.filter((item) => item.due_date !== null).sort(byDue);
  const upcoming = dated.filter((item) => (item.due_date ?? '') >= today);
  const nextAreUpcoming = upcoming.length > 0;

  return {
    counts,
    total: snapshot.items.length,
    dated: dated.length,
    next: (nextAreUpcoming ? upcoming : dated).slice(0, nextCount),
    nextAreUpcoming,
    textbooks: snapshot.textbooks.length,
    termEvents: snapshot.term_events.length,
  };
}

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function contains(term: Term, date: ISODate): boolean {
  return term.start_date !== null && term.end_date !== null && term.start_date <= date && date <= term.end_date;
}

/**
 * Term to import into: one whose dates hold the course start, else one named like the course's
 * season ("Fall 2026"), else a new term with that name, else the active term, else no term.
 */
export function suggestShareTerm(
  course: Pick<SharedSnapshot['course'], 'start_date'>,
  terms: readonly Term[],
): TermSelection {
  const start = course.start_date;
  if (start) {
    const holding = terms.find((term) => contains(term, start));
    if (holding) return { kind: 'existing', termId: holding.id };
  }
  const derived = deriveTermName(start);
  if (derived) {
    const named = terms.find((term) => normalized(term.name) === normalized(derived));
    if (named) return { kind: 'existing', termId: named.id };
  }
  const active = terms.find((term) => term.is_active);
  if (derived && !active) return { kind: 'new', name: derived };
  if (active) return { kind: 'existing', termId: active.id };
  return { kind: 'none' };
}

/** "MATH 221 · Sec 3 · Dr. Okafor" (only the parts the snapshot has). */
export function courseByline(course: Pick<SharedSnapshot['course'], 'code' | 'section' | 'instructor'>): string | null {
  const parts = [
    course.code?.trim(),
    course.section?.trim() ? `Sec ${course.section.trim()}` : null,
    course.instructor?.trim(),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}
