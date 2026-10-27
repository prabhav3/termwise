// Persists LMS discrepancies (canvas, lms-sync). Deno only: needs a supabase-js client from the
// calling function's import map. Students may read/update/dismiss lms_discrepancies but not
// insert them, so writes go through the service-role client with user_id set explicitly.
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http.ts';
import { type DiscrepancyRecord, type ExistingDiscrepancy, planDiscrepancyWrites } from './match.ts';

export interface DiscrepancyScope {
  userId: string;
  connectionId: string;
  courseId: string;
  /** Every dedupe_key of this scope starts with `${prefix}:`. */
  prefix: string;
}

function fail(context: string, error: { code?: string } | null): never {
  console.error(`discrepancies: ${context} failed (${error?.code ?? 'unknown'})`);
  throw new HttpError('internal', "We couldn't save the comparison with your LMS. Please try again.");
}

/** Escapes LIKE wildcards in a literal prefix. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`;
}

/**
 * Reconciles the scope's stored discrepancies with `current`: inserts new ones, reopens or
 * refreshes changed ones, leaves dismissed ones alone, and resolves the ones that went away.
 */
export async function saveDiscrepancies(adminDb: SupabaseClient, scope: DiscrepancyScope, current: DiscrepancyRecord[]): Promise<void> {
  const { data, error } = await adminDb
    .from('lms_discrepancies')
    .select('id, dedupe_key, status, title, detail, syllabus_value, lms_value')
    .eq('user_id', scope.userId)
    .like('dedupe_key', likePrefix(scope.prefix))
    .overrideTypes<ExistingDiscrepancy[], { merge: false }>();
  if (error) fail('lookup', error);

  const plan = planDiscrepancyWrites(data ?? [], current);
  if (plan.upsert.length > 0) {
    const rows = plan.upsert.map((record) => ({
      user_id: scope.userId,
      connection_id: scope.connectionId,
      course_id: scope.courseId,
      item_id: record.item_id,
      kind: record.kind,
      title: record.title.slice(0, 300),
      detail: record.detail,
      syllabus_value: record.syllabus_value,
      lms_value: record.lms_value,
      lms_external_id: record.lms_external_id,
      dedupe_key: record.dedupe_key,
      status: 'open',
      resolved_at: null,
    }));
    const { error: upsertError } = await adminDb.from('lms_discrepancies').upsert(rows, { onConflict: 'user_id,dedupe_key' });
    if (upsertError) fail('save', upsertError);
  }
  if (plan.resolveIds.length > 0) {
    const { error: resolveError } = await adminDb
      .from('lms_discrepancies')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .in('id', plan.resolveIds);
    if (resolveError) fail('resolve', resolveError);
  }
}

/** Open discrepancies of one LMS connection. */
export async function countOpenDiscrepancies(db: SupabaseClient, connectionId: string): Promise<number> {
  const { count, error } = await db
    .from('lms_discrepancies')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .eq('status', 'open');
  if (error) fail('count', error);
  return count ?? 0;
}
