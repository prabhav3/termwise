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

/** Returns `data` or throws an AppError. */
export function unwrap<T>({ data, error }: Result<T>): T {
  if (error) throw toAppError(error);
  if (data === null) throw toAppError({ code: 'PGRST116', message: 'No rows', details: null });
  return data;
}

/** Like unwrap, but a missing row is `null` (for maybeSingle()). */
export function unwrapMaybe<T>({ data, error }: Result<T>): T | null {
  if (error) throw toAppError(error);
  return data;
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
    const batch = unwrap(await page(from, from + PAGE_SIZE - 1));
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
