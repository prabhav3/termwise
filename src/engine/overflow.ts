// Plain-language overflow warnings: what didn't fit and one or two concrete ways out.
import { addDays } from './dates';
import { capitalize, countNoun, courseLabel, formatDayDate, formatMinutes, formatMonthDay } from './format';
import type { LoadBook } from './placement';
import type { AnnotatedItem, EngineCourse, ISODate, OverflowWarning } from './types';

export interface OverflowContext {
  item: AnnotatedItem;
  course: EngineCourse | undefined;
  unplacedMinutes: number;
  /** The study days the item was allowed to use (chronological). */
  windowDays: ISODate[];
  /** Dates this item may not use (missed/skipped there). */
  blocked: Set<ISODate>;
  today: ISODate;
  capacity: number;
  isStudyDay: (date: ISODate) => boolean;
  book: LoadBook;
  /** Every newly planned piece of work, for finding low-impact work to drop. */
  scheduled: ReadonlyArray<{ item: AnnotatedItem; date: ISODate; minutes: number }>;
}

/** Latest date before the window from which free capacity covers the shortfall. */
function startEarlierBy(ctx: OverflowContext): ISODate | null {
  const first = ctx.windowDays[0];
  if (first === undefined || first <= ctx.today) return null;
  let free = 0;
  for (let date = addDays(first, -1); date >= ctx.today; date = addDays(date, -1)) {
    if (ctx.isStudyDay(date) && !ctx.blocked.has(date)) free += Math.max(0, ctx.capacity - ctx.book.get(date));
    if (free >= ctx.unplacedMinutes) return date;
  }
  return null;
}

/** Fewest low-impact items (lower score, not high impact) whose planned time in the window covers the shortfall. */
function lowImpactDrops(ctx: OverflowContext): { count: number; allReadings: boolean } | null {
  const first = ctx.windowDays[0];
  const due = ctx.item.due_date;
  if (first === undefined || due === null) return null;
  const minutesByItem = new Map<string, { item: AnnotatedItem; minutes: number }>();
  for (const piece of ctx.scheduled) {
    const other = piece.item;
    if (other.id === ctx.item.id || other.impact.isHighImpact || other.impact.score >= ctx.item.impact.score) continue;
    if (piece.date < first || piece.date > due) continue;
    const entry = minutesByItem.get(other.id) ?? { item: other, minutes: 0 };
    entry.minutes += piece.minutes;
    minutesByItem.set(other.id, entry);
  }
  const ranked = [...minutesByItem.values()].sort(
    (a, b) => a.item.impact.score - b.item.impact.score || b.minutes - a.minutes || (a.item.id < b.item.id ? -1 : 1),
  );
  let freed = 0;
  const chosen: AnnotatedItem[] = [];
  for (const entry of ranked) {
    chosen.push(entry.item);
    freed += entry.minutes;
    if (freed >= ctx.unplacedMinutes) return { count: chosen.length, allReadings: chosen.every((i) => i.kind === 'reading') };
  }
  return null;
}

export function overflowWarning(ctx: OverflowContext): OverflowWarning {
  const { item } = ctx;
  const ref = `${courseLabel(ctx.course)} ${item.title}`;
  const due = item.due_date ?? ctx.today;
  const message = `Couldn't fit ${formatMinutes(ctx.unplacedMinutes)} of ${ref} before it's due ${formatDayDate(due)}.`;

  const options: string[] = [];
  const startBy = startEarlierBy(ctx);
  if (startBy !== null) options.push(`start ${ref} by ${formatMonthDay(startBy)}`);
  const drops = lowImpactDrops(ctx);
  if (drops !== null) {
    const last = ctx.windowDays[ctx.windowDays.length - 1] ?? due;
    const period = last <= addDays(ctx.today, 6) ? 'this week' : `before ${formatMonthDay(due)}`;
    options.push(`drop ${countNoun(drops.count, drops.allReadings ? 'low-impact reading' : 'low-impact task')} ${period}`);
  }

  let suggestion: string;
  if (options.length > 0) suggestion = options.join(' or ');
  else if (ctx.windowDays.length === 0) {
    suggestion = "there's no study time left before it's due — ask your instructor about an extension or plan to submit what you have";
  } else {
    const perDay = Math.ceil(ctx.unplacedMinutes / ctx.windowDays.length / 5) * 5;
    suggestion = `add about ${perDay} min a day to your study time until ${formatMonthDay(addDays(due, -1))}, or ask your instructor about an extension`;
  }
  return { item_id: item.id, unplacedMinutes: ctx.unplacedMinutes, message, suggestion: capitalize(suggestion) };
}
