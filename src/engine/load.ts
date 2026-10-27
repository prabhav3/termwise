// Day-by-day load summaries.
import { dayOfWeek, eachDay } from './dates';
import type { DayLoad, EngineBlock, ISODate, PlannerSettings } from './types';

/** Builds a fast "is this a study day?" check (weekday in study_days and not blacked out). */
export function studyDayChecker(settings: PlannerSettings): (date: ISODate) => boolean {
  const weekdays = new Set(settings.study_days);
  const blackout = new Set(settings.blackout_dates);
  return (date) => weekdays.has(dayOfWeek(date)) && !blackout.has(date);
}

export function blockPages(block: Pick<EngineBlock, 'page_start' | 'page_end'>): number {
  if (block.page_start == null || block.page_end == null || block.page_end < block.page_start) return 0;
  return block.page_end - block.page_start + 1;
}

/**
 * One entry per date in [from, to]. `capacity` is the daily capacity on study days and 0 otherwise;
 * a day is `overloaded` when it has planned work and planned + done minutes exceed its capacity.
 */
export function computeDayLoads(blocks: EngineBlock[], settings: PlannerSettings, from: ISODate, to: ISODate): DayLoad[] {
  const isStudyDay = studyDayChecker(settings);
  const byDate = new Map<ISODate, EngineBlock[]>();
  for (const block of blocks) {
    if (block.date < from || block.date > to) continue;
    const list = byDate.get(block.date);
    if (list) list.push(block);
    else byDate.set(block.date, [block]);
  }
  return eachDay(from, to).map((date) => {
    let minutes = 0;
    let doneMinutes = 0;
    let pages = 0;
    let blockCount = 0;
    for (const block of byDate.get(date) ?? []) {
      if (block.status === 'planned') {
        minutes += block.minutes;
        pages += blockPages(block);
        blockCount += 1;
      } else if (block.status === 'done') {
        doneMinutes += block.minutes;
      }
    }
    const study = isStudyDay(date);
    const capacity = study ? settings.daily_capacity_minutes : 0;
    return {
      date,
      minutes,
      doneMinutes,
      capacity,
      pages,
      blockCount,
      overloaded: minutes > 0 && minutes + doneMinutes > capacity,
      isStudyDay: study,
    };
  });
}
