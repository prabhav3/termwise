// Student-facing block labels: concrete and short ("Read pp. 101–126 (Ch. 4)",
// "Study for Midterm 1 — 45 min").
import type { PageSegment, ResolvedReading } from './pages';
import type { ItemKind } from './types';

export const MILESTONE_LABELS = {
  start: 'Start: pick topic & gather sources',
  outline: 'Milestone check-in: outline',
  draft: 'Milestone check-in: full draft',
  final: 'Final review & polish',
  rehearse: 'Rehearse out loud',
} as const;

export const POP_QUIZ_LABEL = 'Review notes — pop quiz risk';

/** Drops a leading "Read"/"Reading:" so labels don't read "Read Read Ch. 4". */
function readingSubject(title: string): string {
  const stripped = title.replace(/^read(ing)?\s*:?\s+/i, '').trim();
  return stripped.length > 0 ? stripped : title.trim();
}

export function studyLabel(title: string, minutes: number): string {
  return `Study for ${title} — ${minutes} min`;
}

export function examReviewLabel(title: string, minutes: number): string {
  return `Final review for ${title} — ${minutes} min`;
}

export function workLabel(title: string, minutes: number): string {
  return `Work on ${title} — ${minutes} min`;
}

export function timedReadingLabel(title: string, minutes: number): string {
  return `Read ${readingSubject(title)} — ${minutes} min`;
}

export function finalMilestoneLabel(kind: ItemKind): string {
  return kind === 'presentation' ? MILESTONE_LABELS.rehearse : MILESTONE_LABELS.final;
}

function chapterText(chapter: string): string {
  return /^\d/.test(chapter) ? `Ch. ${chapter}` : chapter;
}

function chaptersOf(pieces: PageSegment[]): string | null {
  const chapters: string[] = [];
  for (const piece of pieces) {
    if (piece.chapter !== null && !chapters.includes(piece.chapter)) chapters.push(piece.chapter);
  }
  if (chapters.length === 0) return null;
  if (chapters.length === 1) return chapterText(chapters[0]);
  const first = chapters[0].split('–')[0];
  const lastParts = chapters[chapters.length - 1].split('–');
  return chapterText(`${first}–${lastParts[lastParts.length - 1]}`);
}

/** "101–126", "10–11, 15" — consecutive pieces are joined into one range. */
function pageText(pieces: PageSegment[]): string {
  const ranges: { start: number; end: number }[] = [];
  for (const piece of pieces) {
    const last = ranges[ranges.length - 1];
    if (last && last.end + 1 === piece.start) last.end = piece.end;
    else ranges.push({ start: piece.start, end: piece.end });
  }
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)).join(', ');
}

function coversWholeSegments(pieces: PageSegment[], reading: ResolvedReading): boolean {
  return pieces.every(
    (p) => p.chapter !== null && reading.segments.some((s) => s.start === p.start && s.end === p.end && s.chapter === p.chapter),
  );
}

export function readingLabel(pieces: PageSegment[], reading: ResolvedReading, title: string): string {
  const pages = pieces.reduce((sum, p) => sum + p.end - p.start + 1, 0);
  const chapters = chaptersOf(pieces);
  const context = chapters ?? readingSubject(title);
  const single = pieces.length === 1 && pieces[0].start === pieces[0].end;
  if (reading.absolute) return `Read ${single ? 'p.' : 'pp.'} ${pageText(pieces)} (${context})`;
  if (pages === reading.total) return `Read ${context} (${pages} ${pages === 1 ? 'page' : 'pages'})`;
  if (chapters !== null && coversWholeSegments(pieces, reading)) return `Read ${chapters} (${pages} pages)`;
  return `Read ${single ? 'page' : 'pages'} ${pageText(pieces)} of ${reading.total} (${context})`;
}
