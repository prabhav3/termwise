// Capacity-aware placement primitives for the planner: a running per-day load book, weighted
// water-filling of a work pool across candidate days, and fixed-date placement.
import type { ISODate } from './types';

const EPSILON = 1e-9;

/** Minutes counted against each day's capacity (kept planned + done blocks, then new work). */
export class LoadBook {
  private readonly loads = new Map<ISODate, number>();

  get(date: ISODate): number {
    return this.loads.get(date) ?? 0;
  }

  add(date: ISODate, minutes: number): void {
    this.loads.set(date, this.get(date) + minutes);
  }
}

/**
 * A quantity of work to spread over `days`. Minute pools use unitMinutes = 1; reading pools use
 * pages as units with unitMinutes = minutes per page (fractional). A day's minutes for an item
 * are always ceil(units × unitMinutes).
 */
export interface Pool {
  unitMinutes: number;
  /** Preferred piece size per step. */
  chunkUnits: number;
  /** Smallest first piece on a day that has none of this pool yet (avoids 5-minute crumbs). */
  minNewDayUnits: number;
  /** Candidate days in chronological order. */
  days: ISODate[];
  /** Optional ramp weights aligned with `days`; a day with weight 2 fills to twice the load. */
  weights?: number[];
}

/** Units placed per day for one item. */
export type Allocation = Map<ISODate, number>;

export function unitsToMinutes(units: number, unitMinutes: number): number {
  return units <= 0 ? 0 : Math.ceil(units * unitMinutes - EPSILON);
}

interface Candidate {
  day: ISODate;
  piece: number;
  metric: number;
}

/**
 * Water-filling: each step adds the next piece to the candidate day whose resulting load
 * (÷ weight) is lowest, never letting a day's total load exceed `limit`. Ties go to the earlier day.
 * A tail smaller than `minNewDayUnits` prefers days that already hold this item's work.
 * Returns the units that could not be placed.
 */
export function fillPool(pool: Pool, alloc: Allocation, book: LoadBook, limit: number, units: number): number {
  let remaining = units;
  const minutes = (u: number) => unitsToMinutes(u, pool.unitMinutes);
  while (remaining > 0) {
    let best: Candidate | null = null;
    let bestExisting: Candidate | null = null;
    for (let i = 0; i < pool.days.length; i++) {
      const day = pool.days[i];
      const current = alloc.get(day) ?? 0;
      const others = book.get(day) - minutes(current);
      const maxTotal = Math.floor((limit - others) / pool.unitMinutes + EPSILON);
      const fit = maxTotal - current;
      if (fit <= 0) continue;
      const minPiece = current === 0 ? Math.min(pool.minNewDayUnits, remaining) : 1;
      const piece = Math.min(Math.max(pool.chunkUnits, minPiece), remaining, fit);
      if (piece < minPiece) continue;
      const metric = (others + minutes(current + piece)) / (pool.weights?.[i] ?? 1);
      const candidate = { day, piece, metric };
      if (best === null || metric < best.metric - EPSILON) best = candidate;
      if (current > 0 && (bestExisting === null || metric < bestExisting.metric - EPSILON)) bestExisting = candidate;
    }
    const pick = remaining < pool.minNewDayUnits && bestExisting !== null ? bestExisting : best;
    if (pick === null) break;
    const current = alloc.get(pick.day) ?? 0;
    book.add(pick.day, minutes(current + pick.piece) - minutes(current));
    alloc.set(pick.day, current + pick.piece);
    remaining -= pick.piece;
  }
  return remaining;
}

/**
 * Places a fixed-size block on the first candidate day with room, trying each limit in order.
 * `stick` tries every limit on a day before moving to the next day (keep the date, accept a
 * heavier day); otherwise every day is tried at the normal limit first (keep the day light).
 */
export function placeFixed(
  minutes: number,
  candidates: ISODate[],
  book: LoadBook,
  limits: number[],
  stick: boolean,
): ISODate | null {
  const attempts: [ISODate, number][] = stick
    ? candidates.flatMap((day) => limits.map((limit): [ISODate, number] => [day, limit]))
    : limits.flatMap((limit) => candidates.map((day): [ISODate, number] => [day, limit]));
  for (const [day, limit] of attempts) {
    if (book.get(day) + minutes <= limit) {
      book.add(day, minutes);
      return day;
    }
  }
  return null;
}
