import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { AppError, toAppError } from '@/lib/functions';
import { supabase } from '@/lib/supabase';

/** PostgREST answers at most this many rows per request (supabase/config.toml max_rows). */
const PAGE_SIZE = 1000;

interface Result<T> {
  data: T | null;
  error: unknown;
}

/** The signed-in user's id, read from the persisted session (no network). */
export async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new AppError('unauthorized', 'Please sign in again.');
  return id;
}

// Typed on the whole response (not `data` alone) so supabase-js' success | failure union keeps
// its row type instead of collapsing to `null` during inference.

/** Returns `data` or throws an AppError. */
export function unwrap<R extends Result<unknown>>(result: R): NonNullable<R['data']> {
  if (result.error) throw toAppError(result.error);
  if (result.data === null || result.data === undefined) {
    throw toAppError({ code: 'PGRST116', message: 'No rows', details: null });
  }
  return result.data as NonNullable<R['data']>;
}

/** Like unwrap, but a missing row is `null` (for maybeSingle() and RPCs that may return null). */
export function unwrapMaybe<R extends Result<unknown>>(result: R): R['data'] | null {
  if (result.error) throw toAppError(result.error);
  return result.data ?? null;
}

/** Throws on error for mutations that return nothing. */
export function check({ error }: { error: unknown }): void {
  if (error) throw toAppError(error);
}

/**
 * Reads every row of a query, page by page. `page(from, to)` must apply a stable order so
 * pages never overlap.
 */
export async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<Result<T[]>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const batch: T[] = unwrap(await page(from, from + PAGE_SIZE - 1));
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Writes a row into a cached list (replace by id, or append). */
export function upsertInList<T extends { id: string }>(client: QueryClient, key: QueryKey, row: T): void {
  client.setQueryData<T[]>(key, (current) => {
    if (!current) return current;
    const index = current.findIndex((existing) => existing.id === row.id);
    if (index === -1) return [...current, row];
    const next = current.slice();
    next[index] = row;
    return next;
  });
}

export function removeFromList<T extends { id: string }>(client: QueryClient, key: QueryKey, id: string): void {
  client.setQueryData<T[]>(key, (current) => current?.filter((row) => row.id !== id));
}

/** Marks several roots stale at once (each refetches if mounted). */
export async function invalidateAll(client: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
