// Student-facing words and icons for plan concepts, shared by Today, Plan, Week and Focus.
import type { SymbolName } from '@/components/ui';
import type { BlockKind, BlockStatus, EngineCourse, EngineTermEvent, ItemKind, RedZone } from '@/engine';
import type { AccentColor } from '@/theme';

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  paper: 'Paper',
  project: 'Project',
  homework: 'Homework',
  reading: 'Reading',
  presentation: 'Presentation',
  lab: 'Lab',
  discussion: 'Discussion',
  other: 'Other',
};

export function itemKindLabel(kind: string): string {
  return kind in ITEM_KIND_LABEL ? ITEM_KIND_LABEL[kind as ItemKind] : 'Other';
}

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  reading: 'Reading',
  work: 'Work session',
  milestone: 'Milestone',
  study: 'Study',
  review: 'Review',
};

export const BLOCK_KIND_ICON: Record<BlockKind, { name: SymbolName; fallback: string }> = {
  reading: { name: 'book.fill', fallback: '▤' },
  work: { name: 'pencil', fallback: '✎' },
  milestone: { name: 'flag.fill', fallback: '⚑' },
  study: { name: 'brain.head.profile', fallback: '◆' },
  review: { name: 'arrow.clockwise', fallback: '↻' },
};

export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = {
  planned: 'Planned',
  done: 'Done',
  missed: 'Moved to later',
  skipped: 'Skipped',
};

type TermEventKind = EngineTermEvent['kind'];

export const TERM_EVENT_LABEL: Record<TermEventKind, string> = {
  holiday: 'Holiday',
  break: 'Break',
  no_class: 'No class',
  finals_period: 'Finals',
  add_drop: 'Add / drop',
  other: 'Term date',
};

export const TERM_EVENT_TONE: Record<TermEventKind, AccentColor | 'surfaceAlt'> = {
  holiday: 'green',
  break: 'green',
  no_class: 'blue',
  finals_period: 'purple',
  add_drop: 'surfaceAlt',
  other: 'surfaceAlt',
};

export function termEventLabel(kind: string): string {
  return kind in TERM_EVENT_LABEL ? TERM_EVENT_LABEL[kind as TermEventKind] : 'Term date';
}

export function termEventTone(kind: string): AccentColor | 'surfaceAlt' {
  return kind in TERM_EVENT_TONE ? TERM_EVENT_TONE[kind as TermEventKind] : 'surfaceAlt';
}

export function zoneTitle(zone: Pick<RedZone, 'severity'>): string {
  return zone.severity === 'red' ? 'Red zone' : 'Crunch ahead';
}

/** Course code, else title (what the course tag shows). */
export function courseName(course: Pick<EngineCourse, 'code' | 'title'> | undefined): string {
  return course?.code?.trim() || course?.title?.trim() || 'Course';
}

/** Spoken minutes: "1 hour 30 minutes". */
export function spokenMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (rest > 0 || hours === 0) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}
