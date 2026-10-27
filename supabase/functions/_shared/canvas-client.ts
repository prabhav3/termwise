// Canvas LMS REST client + pure mapping helpers (kind inference, group weights, scores).
// Runtime-agnostic: requests go through an injected fetcher (safeFetch in production), so the
// mapping logic and pagination are unit-tested under Node.
//
// Canvas notes: list endpoints paginate with a Link header (rel="next"); every response carries
// X-Request-Cost and, when throttling applies, X-Rate-Limit-Remaining; throttled calls get 429
// (older instances: 403 "Rate Limit Exceeded"). An invalid or expired token is a 401 with a
// WWW-Authenticate header; a 401 without it means "not allowed to do that" on one resource.
import { utcToLocal } from './calendar-model.ts';
import { type DiscrepancyRecord, matchCandidates } from './match.ts';
import { assertPublicHttpsUrl, type SafeFetchOptions, type SafeResponse } from './safe-fetch.ts';

export type CanvasId = string;

export interface CanvasUser {
  id: CanvasId;
  name: string;
  short_name?: string | null;
}

export interface CanvasTerm {
  id: CanvasId;
  name: string | null;
  start_at: string | null;
  end_at: string | null;
}

export interface CanvasCourse {
  id: CanvasId;
  name?: string;
  course_code?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  apply_assignment_group_weights?: boolean;
  syllabus_body?: string | null;
  term?: CanvasTerm | null;
  workflow_state?: string;
  access_restricted_by_date?: boolean;
  time_zone?: string | null;
}

export interface CanvasSubmission {
  score: number | null;
  grade: string | null;
  workflow_state: string | null;
  excused?: boolean | null;
  submitted_at: string | null;
  posted_at?: string | null;
  missing?: boolean | null;
}

export interface CanvasAssignment {
  id: CanvasId;
  name: string;
  description: string | null;
  due_at: string | null;
  lock_at: string | null;
  unlock_at: string | null;
  points_possible: number | null;
  submission_types: string[];
  published?: boolean;
  omit_from_final_grade?: boolean;
  assignment_group_id: CanvasId;
  is_quiz_assignment?: boolean;
  html_url?: string;
  submission?: CanvasSubmission | null;
}

export interface CanvasAssignmentGroup {
  id: CanvasId;
  name: string;
  position: number;
  group_weight: number | null;
  rules?: { drop_lowest?: number; drop_highest?: number; never_drop?: CanvasId[] } | null;
  assignments?: CanvasAssignment[];
}

export type CanvasErrorKind = 'auth' | 'forbidden' | 'not_found' | 'rate_limited' | 'upstream';

export class CanvasError extends Error {
  constructor(
    readonly kind: CanvasErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}

export type CanvasFetcher = (url: string, options: SafeFetchOptions) => Promise<SafeResponse>;

// ---------------------------------------------------------------------------
// URL + header helpers
// ---------------------------------------------------------------------------

/**
 * "school.instructure.com/courses/12", "http://school.instructure.com/" → "https://school.instructure.com".
 * Throws SafeFetchError('unsafe_url') for anything that is not a public https host.
 */
export function normalizeCanvasBaseUrl(input: string): string {
  let raw = input.trim();
  if (!raw) raw = ' ';
  if (/^http:\/\//i.test(raw)) raw = `https://${raw.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = assertPublicHttpsUrl(raw);
  return url.origin.toLowerCase();
}

/** Parses an RFC 8288 Link header into rel → URL. */
export function parseLinkHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (!match) continue;
    const rels = /rel="?([^";]+)"?/i.exec(match[2]);
    if (!rels) continue;
    for (const rel of rels[1].trim().split(/\s+/)) out[rel.toLowerCase()] = match[1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_PAGES = 50;
const MAX_RETRIES = 3;

export interface CanvasClientOptions {
  fetcher: CanvasFetcher;
  /** Injected for tests. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Response cap per page (default 8 MiB: syllabus bodies can be large). */
  maxBytes?: number;
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly options: CanvasClientOptions,
  ) {
    this.baseUrl = normalizeCanvasBaseUrl(baseUrl);
    this.sleep = options.sleepFn ?? sleep;
  }

  private url(path: string, query: Array<[string, string]> = []): string {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of query) url.searchParams.append(key, value);
    return url.href;
  }

  private async request(url: string): Promise<SafeResponse> {
    if (new URL(url).origin !== this.baseUrl) {
      throw new CanvasError('upstream', 0, 'Canvas returned a link to a different site.');
    }
    for (let attempt = 0; ; attempt++) {
      const response = await this.options.fetcher(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json+canvas-string-ids, application/json',
        },
        maxBytes: this.options.maxBytes ?? 8 * 1024 * 1024,
        timeoutMs: 20_000,
      });
      const throttled =
        response.status === 429 || (response.status === 403 && /rate limit exceeded/i.test(response.text().slice(0, 500)));
      if (throttled) {
        if (attempt >= MAX_RETRIES) throw new CanvasError('rate_limited', response.status, 'Canvas is busy right now. Try again in a minute.');
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 401) {
        if (response.headers.has('www-authenticate')) {
          throw new CanvasError('auth', 401, 'Canvas no longer accepts this access token.');
        }
        throw new CanvasError('forbidden', 401, 'Canvas does not allow access to this resource.');
      }
      if (response.status === 403) throw new CanvasError('forbidden', 403, 'Canvas does not allow access to this resource.');
      if (response.status === 404) throw new CanvasError('not_found', 404, 'Canvas could not find that.');
      if (!response.ok) throw new CanvasError('upstream', response.status, `Canvas answered with an error (${response.status}).`);

      const remaining = Number(response.headers.get('x-rate-limit-remaining'));
      if (Number.isFinite(remaining) && response.headers.has('x-rate-limit-remaining')) {
        if (remaining < 50) await this.sleep(1500);
        else if (remaining < 150) await this.sleep(300);
      }
      return response;
    }
  }

  private async getJson<T>(path: string, query: Array<[string, string]> = []): Promise<T> {
    const response = await this.request(this.url(path, query));
    try {
      return response.json<T>();
    } catch {
      throw new CanvasError('upstream', response.status, 'Canvas sent a response we could not read.');
    }
  }

  private async getAll<T>(path: string, query: Array<[string, string]> = []): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = this.url(path, [...query, ['per_page', '100']]);
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const response = await this.request(next);
      let rows: unknown;
      try {
        rows = response.json<unknown>();
      } catch {
        throw new CanvasError('upstream', response.status, 'Canvas sent a response we could not read.');
      }
      if (!Array.isArray(rows)) throw new CanvasError('upstream', response.status, 'Canvas sent an unexpected response.');
      out.push(...(rows as T[]));
      next = parseLinkHeader(response.headers.get('link')).next;
    }
    return out;
  }

  getSelf(): Promise<CanvasUser> {
    return this.getJson<CanvasUser>('/api/v1/users/self');
  }

  /** Courses the student is actively enrolled in (date-restricted stubs removed). */
  async listActiveCourses(): Promise<CanvasCourse[]> {
    const courses = await this.getAll<CanvasCourse>('/api/v1/courses', [
      ['enrollment_state', 'active'],
      ['include[]', 'term'],
      ['include[]', 'syllabus_body'],
    ]);
    return courses.filter((c) => !c.access_restricted_by_date && typeof c.name === 'string');
  }

  getCourse(courseId: CanvasId): Promise<CanvasCourse> {
    return this.getJson<CanvasCourse>(`/api/v1/courses/${encodeURIComponent(courseId)}`, [
      ['include[]', 'term'],
      ['include[]', 'syllabus_body'],
    ]);
  }

  listAssignmentGroups(courseId: CanvasId, includeSubmissions: boolean): Promise<CanvasAssignmentGroup[]> {
    const query: Array<[string, string]> = [['include[]', 'assignments']];
    if (includeSubmissions) query.push(['include[]', 'submission']);
    return this.getAll<CanvasAssignmentGroup>(`/api/v1/courses/${encodeURIComponent(courseId)}/assignment_groups`, query);
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export type MappedKind =
  | 'exam'
  | 'quiz'
  | 'paper'
  | 'project'
  | 'homework'
  | 'reading'
  | 'presentation'
  | 'lab'
  | 'discussion'
  | 'other';

// First match wins, so specific words come before generic ones ("Lab Report" is a lab,
// "Assignment: Final Paper" is a paper).
const KEYWORD_KINDS: Array<[RegExp, MappedKind]> = [
  [/\b(mid-?terms?|final exams?|exams?|examination|tests?)\b/i, 'exam'],
  [/\bquiz(z?es)?\b/i, 'quiz'],
  [/\b(presentations?|present|pitch|poster|speech)\b/i, 'presentation'],
  [/\b(projects?|capstone|portfolio)\b/i, 'project'],
  [/\b(labs?|laboratory|practicum)\b/i, 'lab'],
  [/\b(homework|hw|problem sets?|psets?|worksheets?|exercises?)\b/i, 'homework'],
  [/\b(discussions?|forum|discussion board|replies|reply)\b/i, 'discussion'],
  [/\b(papers?|essays?|reports?|thesis|drafts?|reflections?|memo|literature review)\b/i, 'paper'],
  [/\b(readings?|read ch(apter)?s?)\b/i, 'reading'],
  [/\bassignments?\b/i, 'homework'],
];

/** Item kind from the assignment's name keywords, then its submission types. */
export function inferCanvasKind(assignment: Pick<CanvasAssignment, 'name' | 'submission_types' | 'is_quiz_assignment'>): MappedKind {
  const name = assignment.name ?? '';
  const types = assignment.submission_types ?? [];
  const byName = KEYWORD_KINDS.find(([pattern]) => pattern.test(name))?.[1];
  const isQuiz = types.includes('online_quiz') || Boolean(assignment.is_quiz_assignment);
  if (isQuiz) return byName === 'exam' ? 'exam' : 'quiz';
  if (byName) return byName;
  if (types.includes('discussion_topic')) return 'discussion';
  if (types.some((t) => ['online_upload', 'online_text_entry', 'online_url', 'media_recording', 'student_annotation', 'external_tool'].includes(t))) {
    return 'homework';
  }
  return 'other';
}

export interface GroupWeight {
  weight: number;
  /** true when Canvas does not weight groups and the weight is the group's share of points. */
  derived: boolean;
  /** Assignments that count toward the grade. */
  count: number;
  dropLowest: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function countsTowardGrade(a: CanvasAssignment): boolean {
  return a.published !== false && !a.omit_from_final_grade;
}

/**
 * Grading weight per assignment group: Canvas's group_weight when the course applies group
 * weights; otherwise the group's share of total points (which is how Canvas computes an
 * unweighted grade), or an equal split when nothing has points yet.
 */
export function computeGroupWeights(groups: CanvasAssignmentGroup[], applyGroupWeights: boolean): Map<CanvasId, GroupWeight> {
  const out = new Map<CanvasId, GroupWeight>();
  const counted = groups.map((g) => (g.assignments ?? []).filter(countsTowardGrade));
  const dropLowest = (g: CanvasAssignmentGroup) => Math.max(0, Math.floor(g.rules?.drop_lowest ?? 0));
  if (applyGroupWeights) {
    groups.forEach((g, i) => {
      out.set(g.id, { weight: round2(Math.max(0, g.group_weight ?? 0)), derived: false, count: counted[i].length, dropLowest: dropLowest(g) });
    });
    return out;
  }
  const points = counted.map((list) => list.reduce((sum, a) => sum + Math.max(0, a.points_possible ?? 0), 0));
  const total = points.reduce((a, b) => a + b, 0);
  const withWork = counted.filter((list) => list.length > 0).length;
  groups.forEach((g, i) => {
    const weight = total > 0 ? (points[i] / total) * 100 : withWork > 0 && counted[i].length > 0 ? 100 / withWork : 0;
    out.set(g.id, { weight: round2(Math.min(100, weight)), derived: true, count: counted[i].length, dropLowest: dropLowest(g) });
  });
  return out;
}

/** Per-assignment share of the course grade implied by its group (null when unknown). */
export function assignmentWeight(group: GroupWeight | undefined): number | null {
  if (!group || group.count === 0) return null;
  const n = group.count - group.dropLowest >= 1 ? group.count - group.dropLowest : group.count;
  return group.weight / n;
}

const MAJOR_CANVAS_KINDS = new Set<MappedKind>(['exam', 'paper', 'project', 'presentation']);

export function isMajorAssignment(kind: MappedKind, weightPercent: number | null): boolean {
  return MAJOR_CANVAS_KINDS.has(kind) || (weightPercent !== null && weightPercent >= 10);
}

/** The student's score when Canvas shows it to them; null otherwise (excused, ungraded, hidden). */
export function scoreFromSubmission(submission: CanvasSubmission | null | undefined): number | null {
  if (!submission || submission.excused) return null;
  if (typeof submission.score !== 'number' || !Number.isFinite(submission.score)) return null;
  if (submission.workflow_state !== 'graded' && !submission.posted_at) return null;
  return submission.score;
}

/** True when the student has turned the work in (or it was graded / excused). */
export function submissionIsComplete(submission: CanvasSubmission | null | undefined): boolean {
  if (!submission) return false;
  if (submission.excused) return true;
  return ['submitted', 'graded', 'pending_review', 'complete'].includes(submission.workflow_state ?? '') || Boolean(submission.submitted_at);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

/** Plain text from Canvas HTML (descriptions, syllabus), whitespace-collapsed and truncated. */
export function htmlToText(html: string | null | undefined, maxLength = 4000): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#')) {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/** Whether the Canvas syllabus page has any real content (text, a link, or an embed). */
export function hasSyllabusContent(html: string | null | undefined): boolean {
  if (!html) return false;
  return htmlToText(html, 200).length > 0 || /<(a\s[^>]*href|iframe|embed|object|img)\b/i.test(html);
}

// ---------------------------------------------------------------------------
// Assignment → item fields
// ---------------------------------------------------------------------------

/** What one Canvas assignment contributes to a Termwise item, in the student's local time. */
export interface CanvasItemFields {
  external_id: CanvasId;
  group_id: CanvasId;
  title: string;
  kind: MappedKind;
  description: string | null;
  /** Local `YYYY-MM-DD` / `HH:MM` in the student's zone; null when Canvas has no due date. */
  due_date: string | null;
  due_time: string | null;
  assigned_date: string | null;
  lock_date: string | null;
  lock_time: string | null;
  lms_due_at: string | null;
  lms_lock_at: string | null;
  lms_unlock_at: string | null;
  points_possible: number | null;
  /** The visible score; null when not requested, ungraded, excused, or hidden. */
  score: number | null;
  /** Turned in, graded, or excused (only known when submissions were requested). */
  complete: boolean;
  is_major: boolean;
  /** Share of the course grade implied by the assignment group (null when unknown). */
  weight: number | null;
}

function validInstant(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function mapCanvasAssignment(
  assignment: CanvasAssignment,
  options: { timeZone: string; group: GroupWeight | undefined; includeScores: boolean },
): CanvasItemFields {
  const kind = inferCanvasKind(assignment);
  const dueAt = validInstant(assignment.due_at);
  const lockAt = validInstant(assignment.lock_at);
  const unlockAt = validInstant(assignment.unlock_at);
  const due = dueAt ? utcToLocal(dueAt, options.timeZone) : null;
  const lock = lockAt ? utcToLocal(lockAt, options.timeZone) : null;
  const weight = countsTowardGrade(assignment) ? assignmentWeight(options.group) : null;
  const points =
    typeof assignment.points_possible === 'number' && Number.isFinite(assignment.points_possible) && assignment.points_possible >= 0
      ? assignment.points_possible
      : null;
  const description = htmlToText(assignment.description, 2000);
  return {
    external_id: String(assignment.id),
    group_id: String(assignment.assignment_group_id),
    title: (assignment.name ?? '').trim().slice(0, 300) || 'Canvas assignment',
    kind,
    description: description || null,
    due_date: due?.date ?? null,
    due_time: due?.time ?? null,
    assigned_date: unlockAt ? utcToLocal(unlockAt, options.timeZone).date : null,
    lock_date: lock?.date ?? null,
    lock_time: lock?.time ?? null,
    lms_due_at: dueAt,
    lms_lock_at: lockAt,
    lms_unlock_at: unlockAt,
    points_possible: points,
    score: options.includeScores ? scoreFromSubmission(assignment.submission) : null,
    complete: options.includeScores && submissionIsComplete(assignment.submission),
    is_major: isMajorAssignment(kind, weight),
    weight,
  };
}

// ---------------------------------------------------------------------------
// Assignment groups ↔ syllabus grading components
// ---------------------------------------------------------------------------

export interface SyllabusComponentRef {
  id: string;
  name: string;
  weight: number;
  /** Canvas group linked on an earlier sync. */
  canvas_group_id: string | null;
}

const GROUP_MATCH = { threshold: 0.5, minTitle: 0.55 };

/**
 * Pairs Canvas assignment groups with the syllabus's grading components: links from an earlier
 * sync first, then by name similarity one-to-one, then each leftover component joins the group
 * it resembles most (one "Exams" group in Canvas often covers "Midterm" and "Final" in the
 * syllabus). Returns group id → its components.
 */
export function matchGroupsToComponents<C extends SyllabusComponentRef>(
  groups: Array<Pick<CanvasAssignmentGroup, 'id' | 'name'>>,
  components: C[],
): Map<CanvasId, C[]> {
  const out = new Map<CanvasId, C[]>();
  const used = new Set<string>();
  const attach = (groupId: string, component: C) => {
    out.set(groupId, [...(out.get(groupId) ?? []), component]);
    used.add(component.id);
  };
  const groupIds = new Set(groups.map((g) => String(g.id)));
  for (const component of components) {
    if (component.canvas_group_id && groupIds.has(component.canvas_group_id)) attach(component.canvas_group_id, component);
  }

  const groupCandidates = groups.map((g) => ({ id: String(g.id), title: g.name, kind: null, date: null }));
  const componentCandidates = () =>
    components.filter((c) => !used.has(c.id)).map((c) => ({ id: c.id, title: c.name, kind: null, date: null, component: c }));
  const firstPass = matchCandidates(groupCandidates.filter((g) => !out.has(g.id)), componentCandidates(), GROUP_MATCH);
  for (const pair of firstPass.pairs) attach(pair.a.id, pair.b.component);

  for (const leftover of componentCandidates()) {
    const best = matchCandidates([leftover], groupCandidates, GROUP_MATCH).pairs[0];
    if (best) attach(best.b.id, leftover.component);
  }
  return out;
}

const formatWeight = (n: number) => `${Number(n.toFixed(1))}%`;

/**
 * weight_mismatch records for groups matched to syllabus components (a group's weight is compared
 * with the sum of its components). Weights derived from points are approximate, so they get a
 * wider tolerance and the text says how they were computed.
 */
export function buildWeightDiscrepancies(
  scope: string,
  pairs: Array<{ components: SyllabusComponentRef[]; group: Pick<CanvasAssignmentGroup, 'id' | 'name'>; weight: GroupWeight }>,
): DiscrepancyRecord[] {
  const out: DiscrepancyRecord[] = [];
  for (const { components, group, weight } of pairs) {
    if (components.length === 0 || (weight.derived && weight.count === 0)) continue;
    const syllabusWeight = components.reduce((sum, c) => sum + Number(c.weight), 0);
    const tolerance = weight.derived ? 2 : 0.5;
    if (Math.abs(weight.weight - syllabusWeight) <= tolerance) continue;
    const canvasValue = formatWeight(weight.weight);
    const syllabusValue = formatWeight(syllabusWeight);
    const names = components.map((c) => c.name).join(' + ');
    out.push({
      kind: 'weight_mismatch',
      title: names,
      detail: weight.derived
        ? `Canvas doesn't weight assignment groups, so by points “${group.name}” counts for about ${canvasValue} of the grade; the syllabus gives ${names} ${syllabusValue}.`
        : `Canvas weights “${group.name}” at ${canvasValue} of the grade; the syllabus gives ${names} ${syllabusValue}.`,
      syllabus_value: syllabusValue,
      lms_value: weight.derived ? `≈${canvasValue}` : canvasValue,
      item_id: null,
      lms_external_id: String(group.id),
      dedupe_key: `${scope}:weight_mismatch:group:${group.id}`,
    });
  }
  return out;
}
