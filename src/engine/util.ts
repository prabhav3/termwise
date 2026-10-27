// Small shared helpers for deterministic ordering and item state.
import type { EngineItem } from './types';

/** Locale-independent string comparison (stable across devices). */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Still needs work: todo or in progress. */
export function isOpen(item: Pick<EngineItem, 'status'>): boolean {
  return item.status === 'todo' || item.status === 'in_progress';
}
