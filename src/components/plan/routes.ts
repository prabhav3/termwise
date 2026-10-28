// Navigation helpers for plan screens. Paths are built as plain strings and cast once here:
// typed routes cannot see screens other contributors are still adding (item/[id], upload).
import { router, type Href } from 'expo-router';

import { weekHref } from '@/data/plan-views';
import type { ISODate } from '@/lib/dates';

function go(path: string): void {
  router.push(path as Href);
}

export function openItem(itemId: string): void {
  go(`/item/${encodeURIComponent(itemId)}`);
}

/** Opens the week containing `date`. */
export function openWeek(date: ISODate): void {
  go(weekHref(date));
}

export function replaceWeek(date: ISODate): void {
  router.replace(weekHref(date) as string as Href);
}

export interface FocusParams {
  blockKey?: string | null;
  itemId?: string | null;
  minutes?: number | null;
}

export function openFocus(params: FocusParams = {}): void {
  const query: string[] = [];
  if (params.blockKey) query.push(`blockKey=${encodeURIComponent(params.blockKey)}`);
  if (params.itemId) query.push(`itemId=${encodeURIComponent(params.itemId)}`);
  if (params.minutes && params.minutes > 0) query.push(`minutes=${Math.round(params.minutes)}`);
  go(query.length > 0 ? `/focus?${query.join('&')}` : '/focus');
}

export function openUpload(): void {
  go('/upload');
}

export function openPlanTab(): void {
  router.navigate('/plan' as string as Href);
}
