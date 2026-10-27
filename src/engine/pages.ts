// Reading page resolution and page-interval arithmetic. A reading is resolved to an ordered list
// of page segments (absolute book pages when ranges or a chapter map are known, else 1-based
// relative pages) so the planner can continue "from the next unread page".
import type { EngineItem, EngineTextbook, PlannerSettings } from './types';

export interface PageSegment {
  start: number;
  end: number;
  /** Chapter shown in labels ("4", or "4–5" for a span), null when unknown. */
  chapter: string | null;
}

export interface ResolvedReading {
  total: number;
  segments: PageSegment[];
  /** true: page numbers are real book pages; false: 1-based pages within this reading. */
  absolute: boolean;
}

type Chapter = EngineTextbook['chapters'][number];

export function normalizeChapter(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(chapter|chap\.?|ch\.?)\s*/, '')
    .replace(/^0+(?=\d)/, '');
}

function mappedPages(chapter: Chapter | undefined): { start: number; end: number } | null {
  if (!chapter || chapter.start_page == null || chapter.end_page == null) return null;
  if (chapter.end_page < chapter.start_page) return null;
  return { start: chapter.start_page, end: chapter.end_page };
}

/** The reading's textbook, or the course's only textbook when none is named. */
function findTextbook(item: EngineItem, textbooks: EngineTextbook[]): EngineTextbook | undefined {
  const id = item.reading?.textbook_id;
  if (id != null) return textbooks.find((t) => t.id === id);
  const courseBooks = textbooks.filter((t) => t.course_id === item.course_id);
  return courseBooks.length === 1 ? courseBooks[0] : undefined;
}

export function segmentPages(segments: PageSegment[]): number {
  let total = 0;
  for (const s of segments) total += s.end - s.start + 1;
  return total;
}

/** Sorts and merges overlapping ranges (adjacent ranges stay separate segments). */
function normalizeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const valid = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start > 0 && r.end >= r.start)
    .map((r) => ({ start: Math.floor(r.start), end: Math.floor(r.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** Splits an absolute page range at the textbook's chapter boundaries for chapter-aware labels. */
function splitByChapters(range: { start: number; end: number }, textbook: EngineTextbook | undefined): PageSegment[] {
  const bounds = (textbook?.chapters ?? [])
    .map((c) => ({ number: c.number, pages: mappedPages(c) }))
    .filter((c): c is { number: string; pages: { start: number; end: number } } => c.pages !== null)
    .sort((a, b) => a.pages.start - b.pages.start);
  const out: PageSegment[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const chapter = bounds.find((c) => c.pages.start <= cursor && cursor <= c.pages.end);
    if (chapter) {
      const end = Math.min(range.end, chapter.pages.end);
      out.push({ start: cursor, end, chapter: chapter.number });
      cursor = end + 1;
    } else {
      const next = bounds.find((c) => c.pages.start > cursor);
      const end = next ? Math.min(range.end, next.pages.start - 1) : range.end;
      out.push({ start: cursor, end, chapter: null });
      cursor = end + 1;
    }
  }
  // Re-merge contiguous pieces of the same chapter (or unknown chapter).
  const merged: PageSegment[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.chapter === s.chapter && last.end + 1 === s.start) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

function chapterSpan(chapters: string[]): string | null {
  if (chapters.length === 0) return null;
  if (chapters.length === 1) return chapters[0];
  return `${chapters[0]}–${chapters[chapters.length - 1]}`;
}

/**
 * Page count per docs/ENGINE.md (`pages` → explicit_pages → Σ page_ranges → chapter map →
 * chapters × default) plus the page sequence used for labels and progress tracking.
 */
export function resolveReading(item: EngineItem, textbooks: EngineTextbook[], settings: PlannerSettings): ResolvedReading | null {
  const reading = item.reading;
  if (item.kind !== 'reading' && !reading) return null;

  const perChapter = Math.max(1, Math.round(settings.default_pages_per_chapter));
  const ranges = normalizeRanges(reading?.page_ranges ?? []);
  const rangeTotal = ranges.reduce((sum, r) => sum + r.end - r.start + 1, 0);
  const textbook = reading && reading.chapters.length > 0 ? findTextbook(item, textbooks) : undefined;
  const chapters = (reading?.chapters ?? [])
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const key = normalizeChapter(raw);
      const entry = textbook?.chapters.find((c) => normalizeChapter(c.number) === key);
      const pages = mappedPages(entry);
      return { label: entry?.number ?? raw.replace(/^(chapter|chap\.?|ch\.?)\s*/i, ''), pages };
    });
  const chapterTotal = chapters.reduce((sum, c) => sum + (c.pages ? c.pages.end - c.pages.start + 1 : perChapter), 0);

  let total: number;
  if (item.pages != null && item.pages > 0) total = Math.round(item.pages);
  else if (reading?.explicit_pages != null && reading.explicit_pages > 0) total = Math.round(reading.explicit_pages);
  else if (rangeTotal > 0) total = rangeTotal;
  else if (chapters.length > 0) total = chapterTotal;
  else return null;

  const listed = chapterSpan(chapters.map((c) => c.label));
  if (rangeTotal > 0 && rangeTotal === total) {
    const book = textbook ?? findTextbook(item, textbooks);
    const segments = ranges
      .flatMap((r) => splitByChapters(r, book))
      .map((s) => (s.chapter === null && listed !== null ? { ...s, chapter: listed } : s));
    return { total, segments, absolute: true };
  }
  const mapped = chapters.flatMap((c) => (c.pages ? [{ start: c.pages.start, end: c.pages.end, chapter: c.label }] : []));
  if (chapters.length > 0 && mapped.length === chapters.length && chapterTotal === total) {
    return { total, segments: mapped, absolute: true };
  }
  if (chapters.length > 0 && chapterTotal === total) {
    let cursor = 1;
    const segments = chapters.map((c) => {
      const size = c.pages ? c.pages.end - c.pages.start + 1 : perChapter;
      const segment = { start: cursor, end: cursor + size - 1, chapter: c.label };
      cursor += size;
      return segment;
    });
    return { total, segments, absolute: false };
  }
  return { total, segments: [{ start: 1, end: total, chapter: listed }], absolute: false };
}

/** Pages of `segments` that fall inside [start, end]. */
export function pagesWithin(segments: PageSegment[], start: number, end: number): number {
  let count = 0;
  for (const s of segments) {
    const lo = Math.max(s.start, start);
    const hi = Math.min(s.end, end);
    if (hi >= lo) count += hi - lo + 1;
  }
  return count;
}

/** Removes [start, end] from every segment. */
export function subtractRange(segments: PageSegment[], start: number, end: number): PageSegment[] {
  const out: PageSegment[] = [];
  for (const s of segments) {
    if (end < s.start || start > s.end) {
      out.push(s);
      continue;
    }
    if (start > s.start) out.push({ ...s, end: start - 1 });
    if (end < s.end) out.push({ ...s, start: end + 1 });
  }
  return out;
}

/** Splits off the first `count` pages. */
export function takePages(segments: PageSegment[], count: number): { taken: PageSegment[]; rest: PageSegment[] } {
  const taken: PageSegment[] = [];
  const rest: PageSegment[] = [];
  let left = count;
  for (const s of segments) {
    const size = s.end - s.start + 1;
    if (left <= 0) rest.push(s);
    else if (size <= left) {
      taken.push(s);
      left -= size;
    } else {
      taken.push({ ...s, end: s.start + left - 1 });
      rest.push({ ...s, start: s.start + left });
      left = 0;
    }
  }
  return { taken, rest };
}

/** Groups pieces into runs of consecutive page numbers (one block per run). */
export function contiguousRuns(pieces: PageSegment[]): PageSegment[][] {
  const runs: PageSegment[][] = [];
  for (const piece of pieces) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && last.end + 1 === piece.start) run.push(piece);
    else runs.push([piece]);
  }
  return runs;
}
