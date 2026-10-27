// Storage helpers for account deletion (admin client: bypasses RLS, so callers must pass a
// prefix they have already scoped to the caller).
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../_shared/http.ts';

const PAGE_SIZE = 1000;
/** Storage's bulk delete accepts up to 1000 keys per request. */
const REMOVE_BATCH = 1000;
const FAILED = "We couldn't delete your uploaded files. Please try again.";

/** Every object key under `prefix/` (recursing into folders). */
export async function listObjectPaths(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  const folders = [prefix.replace(/\/+$/, '')];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        console.error(`account: storage list failed (${error.name})`);
        throw new HttpError('internal', FAILED);
      }
      for (const entry of data) {
        const path = `${folder}/${entry.name}`;
        // Folders come back as entries without an id.
        if (entry.id === null) folders.push(path);
        else paths.push(path);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }
  return paths;
}

export async function removeObjects(client: SupabaseClient, bucket: string, paths: readonly string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await client.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) {
      console.error(`account: storage remove failed (${error.name})`);
      throw new HttpError('internal', FAILED);
    }
  }
}
