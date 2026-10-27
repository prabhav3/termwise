// Database rows parse-syllabus reads and writes. Rows from the untyped supabase client are
// validated with zod before use.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { PromptCourseContext } from '../_shared/prompts.ts';

export const SYLLABI_BUCKET = 'syllabi';

// Only the fields the parser uses; a missing MIME type falls back to the file extension.
export const UploadFileSchema = z.object({
  path: z.string().min(1),
  mime: z.string().default(''),
  name: z.string().default(''),
});
export type UploadFile = z.infer<typeof UploadFileSchema>;

export const UploadRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  course_id: z.string().nullable(),
  kind: z.enum(['syllabus', 'toc']),
  source: z.enum(['upload', 'paste', 'canvas']),
  files: z.array(UploadFileSchema),
  pasted_text: z.string().nullable(),
  status: z.enum(['uploaded', 'processing', 'needs_review', 'imported', 'failed']),
  processing_started_at: z.string().nullable(),
});
export type UploadRow = z.infer<typeof UploadRowSchema>;
export const UPLOAD_COLUMNS = 'id, user_id, course_id, kind, source, files, pasted_text, status, processing_started_at';

const DEFAULT_TIMEZONE = 'America/New_York';

export async function loadTimezone(client: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await client.from('profiles').select('timezone').eq('id', userId).maybeSingle();
  const parsed = z.object({ timezone: z.string().min(1) }).safeParse(data);
  if (error || !parsed.success) {
    if (error) console.warn(`parse-syllabus: profile lookup failed (${error.code})`);
    return DEFAULT_TIMEZONE;
  }
  return parsed.data.timezone;
}

const CourseRowSchema = z.object({
  title: z.string(),
  code: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  meeting_days: z.array(z.number().int()),
  meeting_start: z.string().nullable(),
  meeting_end: z.string().nullable(),
  term: z.object({ name: z.string(), start_date: z.string().nullable(), end_date: z.string().nullable() }).nullable(),
});

/** The linked course (with its term) as prompt context; null when unlinked or unreadable. */
export async function loadCourseContext(client: SupabaseClient, courseId: string | null): Promise<PromptCourseContext | null> {
  if (!courseId) return null;
  const { data, error } = await client
    .from('courses')
    .select('title, code, start_date, end_date, meeting_days, meeting_start, meeting_end, term:terms(name, start_date, end_date)')
    .eq('id', courseId)
    .maybeSingle();
  if (error) {
    console.warn(`parse-syllabus: course lookup failed (${error.code})`);
    return null;
  }
  const parsed = CourseRowSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

type UploadPatch = {
  status?: 'needs_review' | 'failed';
  progress_note?: string | null;
  error?: string | null;
  extraction?: unknown;
  model?: string | null;
  usage?: unknown;
};

/**
 * Writes for one claimed parse job. Every write is scoped to the claim (same
 * processing_started_at, still 'processing'), so a superseded job can never overwrite a newer
 * one. Uses the admin client so a user JWT expiring mid-job can't strand the row.
 */
export class UploadJobWriter {
  constructor(
    private readonly admin: SupabaseClient,
    readonly uploadId: string,
    private readonly userId: string,
    private readonly startedAt: string,
  ) {}

  async #update(patch: UploadPatch, label: string): Promise<void> {
    const { error } = await this.admin
      .from('syllabus_uploads')
      .update(patch)
      .eq('id', this.uploadId)
      .eq('user_id', this.userId)
      .eq('status', 'processing')
      .eq('processing_started_at', this.startedAt);
    if (error) console.error(`parse-syllabus: ${label} write failed for upload ${this.uploadId} (${error.code})`);
  }

  note(progressNote: string): Promise<void> {
    return this.#update({ progress_note: progressNote }, 'progress');
  }

  succeed(result: { extraction: unknown; model: string; usage: unknown }): Promise<void> {
    return this.#update({ status: 'needs_review', progress_note: null, error: null, ...result }, 'result');
  }

  fail(message: string): Promise<void> {
    return this.#update({ status: 'failed', progress_note: null, error: message }, 'failure');
  }
}
