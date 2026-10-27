// Fuzzy matching between syllabus items and LMS assignments / feed events, and the discrepancy
// records that fall out of it. Pure TypeScript shared by the edge functions (canvas, lms-sync)
// and the app: no imports, no runtime APIs.
//
// A pair scores 0.6·title + 0.25·date + 0.15·kind, where
//   title — token-set similarity after normalization ("Quiz #1" ≈ "Quiz 1: Memory"), forced low
//           when the two titles carry different instance numbers ("Quiz 1" vs "Quiz 2") or
//           exclusive qualifiers ("Midterm" vs "Final");
//   date  — proximity of the two due dates (neutral when either is unknown);
//   kind  — compatibility of the item kinds (a reading never matches an exam).
// Pairs above the threshold are assigned greedily, best first, one-to-one.

export type DiscrepancyKind =
  | 'date_mismatch'
  | 'missing_in_lms'
  | 'missing_in_syllabus'
  | 'locks_before_due'
  | 'weight_mismatch'
  | 'points_mismatch';

export interface MatchCandidate {
  id: string;
  title: string;
  kind: string | null;
  /** Local due date `YYYY-MM-DD`, null when unknown. */
  date: string | null;
}

export interface MatchPair<A, B> {
  a: A;
  b: B;
  score: number;
}

export interface MatchResult<A, B> {
  pairs: MatchPair<A, B>[];
  unmatchedA: A[];
  unmatchedB: B[];
}

export interface MatchOptions {
  /** Minimum combined score (default 0.6). */
  threshold?: number;
  /** Minimum title similarity (default 0.5). */
  minTitle?: number;
}

// ---------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------

const SYNONYMS: Record<string, string> = {
  hw: 'hw', homework: 'hw', homeworks: 'hw', assignment: 'hw', assignments: 'hw', assn: 'hw', asgmt: 'hw',
  pset: 'hw', psets: 'hw', exercise: 'hw', exercises: 'hw', worksheet: 'hw',
  exam: 'exam', exams: 'exam', examination: 'exam', test: 'exam', tests: 'exam',
  midterm: 'midterm', midterms: 'midterm', mid: 'midterm', midsemester: 'midterm',
  final: 'final', finals: 'final',
  quiz: 'quiz', quizzes: 'quiz', quizz: 'quiz',
  paper: 'paper', papers: 'paper', essay: 'paper', essays: 'paper',
  project: 'project', projects: 'project', proj: 'project',
  presentation: 'presentation', presentations: 'presentation', pres: 'presentation',
  lab: 'lab', labs: 'lab', laboratory: 'lab',
  discussion: 'discussion', discussions: 'discussion', disc: 'discussion', forum: 'discussion',
  reading: 'reading', readings: 'reading', read: 'reading',
  chapter: 'ch', chapters: 'ch', ch: 'ch', chap: 'ch', chs: 'ch',
  week: 'week', weeks: 'week', wk: 'week',
  unit: 'unit', units: 'unit', module: 'unit', modules: 'unit', mod: 'unit',
  part: 'part', pt: 'part',
  report: 'report', reports: 'report',
  draft: 'draft', drafts: 'draft',
  problem: 'hw', problems: 'hw',
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'on', 'in', 'to', 'at', 'by', 'with', 'due', 'submission',
  'submit', 'upload', 'online', 'canvas', 'term', 'st', 'nd', 'rd', 'th', 'no', 'num', 'number', 'set',
]);

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8',
  ninth: '9', tenth: '10',
};

const ROMAN: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

/** Tokens after which a bare number or roman numeral names an instance ("Exam II", "Unit 3"). */
const INSTANCE_HEADS = new Set(['hw', 'exam', 'midterm', 'final', 'quiz', 'paper', 'project', 'presentation', 'lab',
  'discussion', 'reading', 'ch', 'week', 'unit', 'part', 'report', 'draft']);

const KIND_TOKENS = new Set(['exam', 'midterm', 'final', 'quiz', 'paper', 'project', 'presentation', 'lab', 'discussion', 'reading']);

const EXCLUSIVE_QUALIFIERS: Array<[string, string]> = [['midterm', 'final']];

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ordered canonical tokens of a title. */
export function titleTokens(title: string): string[] {
  const raw = normalizeTitle(title).split(' ').filter(Boolean);
  const out: string[] = [];
  let assignmentIndex = -1;
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i];
    const prev = out[out.length - 1];
    if (/^\d+$/.test(word)) {
      out.push(String(Number(word)));
      continue;
    }
    if (word in NUMBER_WORDS) {
      out.push(NUMBER_WORDS[word]);
      continue;
    }
    if (word in ROMAN && prev !== undefined && INSTANCE_HEADS.has(prev)) {
      out.push(ROMAN[word]);
      continue;
    }
    if (STOPWORDS.has(word)) continue;
    const canonical = SYNONYMS[word] ?? word;
    if (word === 'assignment' || word === 'assignments') assignmentIndex = out.length;
    out.push(canonical);
  }
  // "Assignment: Research Paper" — the generic word adds nothing when a specific kind is named.
  if (assignmentIndex >= 0 && out.some((t) => KIND_TOKENS.has(t))) out.splice(assignmentIndex, 1);
  return out;
}

function primaryNumber(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    if (/^\d+$/.test(tokens[i]) && INSTANCE_HEADS.has(tokens[i - 1])) return tokens[i];
  }
  return null;
}

/** Token-set similarity in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const A = new Set(ta);
  const B = new Set(tb);

  for (const [x, y] of EXCLUSIVE_QUALIFIERS) {
    if ((A.has(x) && !A.has(y) && B.has(y) && !B.has(x)) || (A.has(y) && !A.has(x) && B.has(x) && !B.has(y))) return 0.1;
  }
  const pa = primaryNumber(ta);
  const pb = primaryNumber(tb);
  if (pa !== null && pb !== null && pa !== pb) return 0.1;
  const numsA = [...A].filter((t) => /^\d+$/.test(t));
  const numsB = [...B].filter((t) => /^\d+$/.test(t));
  if (numsA.length > 0 && numsB.length > 0 && !numsA.some((n) => B.has(n))) return 0.1;

  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const overlap = shared / Math.min(A.size, B.size);
  const dice = (2 * shared) / (A.size + B.size);
  return 0.6 * overlap + 0.4 * dice;
}

// ---------------------------------------------------------------------------
// Kind and date
// ---------------------------------------------------------------------------

const LOOSE_GROUPS: Array<[Set<string>, number]> = [
  [new Set(['paper', 'project', 'presentation', 'homework']), 0.6],
  [new Set(['homework', 'lab', 'discussion']), 0.6],
  [new Set(['exam', 'quiz']), 0.4],
];

/** Kind compatibility in [0, 1]; 0 means never match. */
export function kindCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0.6;
  if (a === b) return 1;
  if (a === 'other' || b === 'other') return 0.6;
  if (a === 'reading' || b === 'reading') return 0;
  for (const [group, score] of LOOSE_GROUPS) if (group.has(a) && group.has(b)) return score;
  return 0.1;
}

export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round(Math.abs(toUtc(a) - toUtc(b)) / 86_400_000);
}

/** Date proximity in [0, 1]; null when either side has no date. */
export function dateProximity(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = daysBetween(a, b);
  if (d === 0) return 1;
  if (d === 1) return 0.85;
  if (d === 2) return 0.7;
  if (d <= 3) return 0.6;
  if (d <= 7) return 0.4;
  if (d <= 14) return 0.2;
  return 0.05;
}

export function pairScore(a: MatchCandidate, b: MatchCandidate): { score: number; title: number } {
  const kind = kindCompatibility(a.kind, b.kind);
  if (kind === 0) return { score: 0, title: 0 };
  const title = titleSimilarity(a.title, b.title);
  const date = dateProximity(a.date, b.date) ?? 0.4;
  return { score: 0.6 * title + 0.25 * date + 0.15 * kind, title };
}

/** Best one-to-one matching between two candidate lists. */
export function matchCandidates<A extends MatchCandidate, B extends MatchCandidate>(
  as: A[],
  bs: B[],
  options: MatchOptions = {},
): MatchResult<A, B> {
  const threshold = options.threshold ?? 0.6;
  const minTitle = options.minTitle ?? 0.5;
  const scored: Array<{ i: number; j: number; score: number; gap: number }> = [];
  as.forEach((a, i) => {
    bs.forEach((b, j) => {
      const { score, title } = pairScore(a, b);
      if (score >= threshold && title >= minTitle) {
        const gap = a.date && b.date ? daysBetween(a.date, b.date) : 999;
        scored.push({ i, j, score, gap });
      }
    });
  });
  scored.sort((x, y) => y.score - x.score || x.gap - y.gap || x.i - y.i || x.j - y.j);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: MatchPair<A, B>[] = [];
  for (const s of scored) {
    if (usedA.has(s.i) || usedB.has(s.j)) continue;
    usedA.add(s.i);
    usedB.add(s.j);
    pairs.push({ a: as[s.i], b: bs[s.j], score: Math.round(s.score * 1000) / 1000 });
  }
  return {
    pairs,
    unmatchedA: as.filter((_, i) => !usedA.has(i)),
    unmatchedB: bs.filter((_, j) => !usedB.has(j)),
  };
}

// ---------------------------------------------------------------------------
// Discrepancies
// ---------------------------------------------------------------------------

export interface DiscrepancyRecord {
  kind: DiscrepancyKind;
  title: string;
  detail: string | null;
  syllabus_value: string | null;
  lms_value: string | null;
  item_id: string | null;
  lms_external_id: string | null;
  dedupe_key: string;
}

export interface SyllabusSide {
  id: string;
  title: string;
  kind: string;
  due_date: string | null;
  due_time: string | null;
  is_major: boolean;
  points_possible: number | null;
}

export interface LmsSide {
  external_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  /** Local date/time the LMS stops accepting submissions. */
  lock_date: string | null;
  lock_time: string | null;
  points_possible: number | null;
}

export interface ItemDiscrepancyInput {
  /** Dedupe-key prefix that identifies the connection (and course), e.g. "canvas:<conn>:<course>". */
  scope: string;
  /** Name of the LMS for student-facing text, e.g. "Canvas". */
  lmsName: string;
  pairs: Array<{ syllabus: SyllabusSide; lms: LmsSide }>;
  unmatchedSyllabus: SyllabusSide[];
  unmatchedLms: LmsSide[];
  /** Only report missing_in_lms for syllabus items due inside this window (feeds cover a range). */
  window?: { from: string; to: string } | null;
  checkLocks?: boolean;
  checkPoints?: boolean;
}

const MAJOR = new Set(['exam', 'paper', 'project', 'presentation']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hhmm(time: string | null): string | null {
  return time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : null;
}

function humanDate(date: string, time: string | null): string {
  const [, m, d] = date.split('-').map(Number);
  const t = hhmm(time);
  if (!t) return `${MONTHS[m - 1]} ${d}`;
  const [h, min] = t.split(':').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function stamp(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const t = hhmm(time);
  return t ? `${date} ${t}` : date;
}

function formatPoints(n: number): string {
  return String(Number(n.toFixed(2)));
}

export function buildItemDiscrepancies(input: ItemDiscrepancyInput): DiscrepancyRecord[] {
  const out: DiscrepancyRecord[] = [];
  const { scope, lmsName } = input;

  for (const { syllabus, lms } of input.pairs) {
    if (syllabus.due_date && lms.due_date && syllabus.due_date !== lms.due_date) {
      out.push({
        kind: 'date_mismatch',
        title: syllabus.title,
        detail: `${lmsName} lists this as due ${humanDate(lms.due_date, lms.due_time)}, but the syllabus says ${humanDate(syllabus.due_date, syllabus.due_time)}.`,
        syllabus_value: stamp(syllabus.due_date, syllabus.due_time),
        lms_value: stamp(lms.due_date, lms.due_time),
        item_id: syllabus.id,
        lms_external_id: lms.external_id,
        dedupe_key: `${scope}:date_mismatch:${syllabus.id}`,
      });
    }
    if (input.checkLocks && syllabus.due_date && lms.lock_date) {
      const deadline = `${syllabus.due_date} ${hhmm(syllabus.due_time) ?? '23:59'}`;
      const lock = `${lms.lock_date} ${hhmm(lms.lock_time) ?? '23:59'}`;
      if (lock < deadline) {
        out.push({
          kind: 'locks_before_due',
          title: syllabus.title,
          detail: `${lmsName} stops accepting submissions ${humanDate(lms.lock_date, lms.lock_time)}, before the syllabus deadline (${humanDate(syllabus.due_date, syllabus.due_time ?? '23:59')}).`,
          syllabus_value: deadline,
          lms_value: lock,
          item_id: syllabus.id,
          lms_external_id: lms.external_id,
          dedupe_key: `${scope}:locks_before_due:${syllabus.id}`,
        });
      }
    }
    if (
      input.checkPoints &&
      syllabus.points_possible !== null &&
      lms.points_possible !== null &&
      Math.abs(syllabus.points_possible - lms.points_possible) > 0.001
    ) {
      out.push({
        kind: 'points_mismatch',
        title: syllabus.title,
        detail: `${lmsName} grades this out of ${formatPoints(lms.points_possible)} points; the syllabus says ${formatPoints(syllabus.points_possible)}.`,
        syllabus_value: formatPoints(syllabus.points_possible),
        lms_value: formatPoints(lms.points_possible),
        item_id: syllabus.id,
        lms_external_id: lms.external_id,
        dedupe_key: `${scope}:points_mismatch:${syllabus.id}`,
      });
    }
  }

  for (const syllabus of input.unmatchedSyllabus) {
    if (!syllabus.is_major && !MAJOR.has(syllabus.kind)) continue;
    if (input.window && (!syllabus.due_date || syllabus.due_date < input.window.from || syllabus.due_date > input.window.to)) {
      continue;
    }
    out.push({
      kind: 'missing_in_lms',
      title: syllabus.title,
      detail: `The syllabus lists this${syllabus.due_date ? ` for ${humanDate(syllabus.due_date, syllabus.due_time)}` : ''}, but it isn't in ${lmsName} yet.`,
      syllabus_value: stamp(syllabus.due_date, syllabus.due_time),
      lms_value: null,
      item_id: syllabus.id,
      lms_external_id: null,
      dedupe_key: `${scope}:missing_in_lms:${syllabus.id}`,
    });
  }

  for (const lms of input.unmatchedLms) {
    out.push({
      kind: 'missing_in_syllabus',
      title: lms.title,
      detail: `${lmsName} has this${lms.due_date ? ` due ${humanDate(lms.due_date, lms.due_time)}` : ''}, but the syllabus doesn't mention it.`,
      syllabus_value: null,
      lms_value: stamp(lms.due_date, lms.due_time),
      item_id: null,
      lms_external_id: lms.external_id,
      dedupe_key: `${scope}:missing_in_syllabus:${lms.external_id}`,
    });
  }
  return out;
}

export interface ExistingDiscrepancy {
  id: string;
  dedupe_key: string;
  status: 'open' | 'resolved' | 'dismissed';
  title: string;
  detail: string | null;
  syllabus_value: string | null;
  lms_value: string | null;
}

export interface DiscrepancyWritePlan {
  /** Insert or refresh as open. */
  upsert: DiscrepancyRecord[];
  /** Open rows that no longer apply. */
  resolveIds: string[];
}

/**
 * Reconciles freshly computed discrepancies with the stored ones of the same scope: new or changed
 * ones become open, unchanged open ones are left alone, dismissed ones stay dismissed unless the
 * underlying values changed, and open ones that disappeared are resolved.
 */
export function planDiscrepancyWrites(existing: ExistingDiscrepancy[], current: DiscrepancyRecord[]): DiscrepancyWritePlan {
  const byKey = new Map(existing.map((e) => [e.dedupe_key, e]));
  const currentKeys = new Set<string>();
  const upsert: DiscrepancyRecord[] = [];
  for (const record of current) {
    if (currentKeys.has(record.dedupe_key)) continue;
    currentKeys.add(record.dedupe_key);
    const prior = byKey.get(record.dedupe_key);
    const sameValues = prior !== undefined && prior.syllabus_value === record.syllabus_value && prior.lms_value === record.lms_value;
    if (prior?.status === 'dismissed' && sameValues) continue;
    if (prior?.status === 'open' && sameValues && prior.title === record.title && prior.detail === record.detail) continue;
    upsert.push(record);
  }
  const resolveIds = existing.filter((e) => e.status === 'open' && !currentKeys.has(e.dedupe_key)).map((e) => e.id);
  return { upsert, resolveIds };
}
