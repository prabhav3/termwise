// parse-syllabus (auth: user) — POST { upload_id } -> 202 { upload_id, status: 'processing' }.
// Claims the syllabus_uploads row, answers immediately, and finishes the AI extraction in the
// background (job.ts). The app watches the row until it is needs_review or failed.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { ParseSyllabusRequest, ParseSyllabusResponse } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { createClaudeClient, DEFAULT_PARSE_MODEL, parseEffort } from '../_shared/claude.ts';
import { handle, HttpError, json, readJson, requireEnv } from '../_shared/http.ts';
import { classifyOrThrow } from './content.ts';
import { failActiveJobs, runParseJob } from './job.ts';
import { UPLOAD_COLUMNS, type UploadRow, UploadRowSchema } from './rows.ts';

// Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/** A 'processing' row older than this is treated as abandoned (paid wall-clock limit is 400 s). */
const STALE_AFTER_MS = 6 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

addEventListener('beforeunload', () => failActiveJobs());

async function loadUpload(ctx: SupabaseContext, uploadId: string): Promise<UploadRow> {
  // User-scoped client: RLS proves the caller owns the row.
  const { data, error } = await ctx.supabase.from('syllabus_uploads').select(UPLOAD_COLUMNS).eq('id', uploadId).maybeSingle();
  if (error) {
    console.error(`parse-syllabus: upload lookup failed (${error.code})`);
    throw new HttpError('internal', "We couldn't load this upload. Please try again.");
  }
  if (!data) throw new HttpError('not_found', 'Upload not found.');
  const parsed = UploadRowSchema.safeParse(data);
  if (!parsed.success) throw new HttpError('bad_request', 'This upload is incomplete. Please upload the syllabus again.');
  return parsed.data;
}

/** Reject uploads Claude can't read before claiming them, recording the reason on the row. */
async function validateInputs(ctx: SupabaseContext, upload: UploadRow, userId: string): Promise<void> {
  if (upload.files.some((f) => !f.path.startsWith(`${userId}/`))) {
    throw new HttpError('bad_request', 'This upload points at files outside your account.');
  }
  if (upload.files.length === 0 && !upload.pasted_text?.trim()) {
    throw new HttpError('bad_request', "There's nothing to read in this upload yet.");
  }
  try {
    upload.files.forEach(classifyOrThrow);
  } catch (err) {
    if (err instanceof HttpError) {
      await ctx.supabase.from('syllabus_uploads').update({ status: 'failed', error: err.message, progress_note: null }).eq('id', upload.id);
    }
    throw err;
  }
}

/** Atomically move the row to 'processing' unless a fresh job already holds it. */
async function claim(ctx: SupabaseContext, uploadId: string, startedAt: string, staleBefore: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from('syllabus_uploads')
    .update({ status: 'processing', processing_started_at: startedAt, progress_note: 'Getting your files…', error: null })
    .eq('id', uploadId)
    .neq('status', 'imported')
    .or(`status.neq.processing,processing_started_at.is.null,processing_started_at.lt."${staleBefore}"`)
    .select('id');
  if (error) {
    console.error(`parse-syllabus: claim failed (${error.code})`);
    throw new HttpError('internal', "We couldn't start reading this upload. Please try again.");
  }
  if (!data || data.length === 0) throw new HttpError('conflict', "We're already reading this upload.");
}

async function parseSyllabus(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const userId = requireUserId(ctx);
  const body = await readJson<Partial<ParseSyllabusRequest> | null>(req);
  const uploadId = typeof body?.upload_id === 'string' ? body.upload_id.trim() : '';
  if (!UUID_RE.test(uploadId)) throw new HttpError('bad_request', 'upload_id must be a UUID.');
  const apiKey = requireEnv('ANTHROPIC_API_KEY');

  const upload = await loadUpload(ctx, uploadId);
  if (upload.status === 'imported') throw new HttpError('conflict', 'This syllabus was already imported.');
  const now = Date.now();
  const startedMs = upload.processing_started_at ? Date.parse(upload.processing_started_at) : Number.NaN;
  if (upload.status === 'processing' && now - startedMs < STALE_AFTER_MS) {
    throw new HttpError('conflict', "We're already reading this upload.");
  }
  await validateInputs(ctx, upload, userId);

  const startedAt = new Date(now).toISOString();
  await claim(ctx, uploadId, startedAt, new Date(now - STALE_AFTER_MS).toISOString());

  EdgeRuntime.waitUntil(
    runParseJob({
      upload,
      userId,
      startedAt,
      userClient: ctx.supabase,
      adminClient: ctx.supabaseAdmin,
      anthropic: createClaudeClient(apiKey),
      model: Deno.env.get('PARSE_MODEL')?.trim() || DEFAULT_PARSE_MODEL,
      effort: parseEffort(Deno.env.get('PARSE_EFFORT')),
    }).catch((err: unknown) => console.error(`parse-syllabus: job crashed (${err instanceof Error ? err.name : 'unknown'})`)),
  );

  const response: ParseSyllabusResponse = { upload_id: uploadId, status: 'processing' };
  return json(response, 202);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(parseSyllabus)) };
