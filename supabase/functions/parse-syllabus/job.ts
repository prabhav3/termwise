// The background half of parse-syllabus: build the request, stream Claude's structured output,
// validate it, and leave the upload row in needs_review (with the extraction) or failed (with a
// message the student can act on). Runs inside EdgeRuntime.waitUntil.
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteClaudeFiles,
  describeClaudeError,
  type Effort,
  requestStructuredOutput,
  type StructuredOutcome,
  usageSummary,
} from '../_shared/claude.ts';
import { normalizeExtraction, SyllabusExtraction, TocExtraction } from '../_shared/extraction.ts';
import { HttpError } from '../_shared/http.ts';
import { parseStructuredOutput, toClaudeOutputSchema } from '../_shared/json-schema.ts';
import { buildUserPrompt, localDateISO, normalizeTocExtraction, systemPromptFor } from '../_shared/prompts.ts';
import { prepareContent } from './content.ts';
import { ProgressReporter } from './progress.ts';
import { loadCourseContext, loadTimezone, UploadJobWriter, type UploadRow } from './rows.ts';

const OUTPUT_SCHEMAS = {
  syllabus: toClaudeOutputSchema(SyllabusExtraction),
  toc: toClaudeOutputSchema(TocExtraction),
} as const;

const MESSAGES = {
  refusal: "We weren't able to read this document. If it's a course syllabus, try uploading it as a PDF or pasting its text instead.",
  tooLong: 'This document is too long to read in one pass — try uploading the schedule pages separately.',
  unreadable: "We couldn't make sense of this document. Please try again, or upload a clearer copy.",
  shutdown: 'Reading took longer than we allow. Try uploading just the schedule and grading pages, then try again.',
} as const;

export interface ParseJobInput {
  upload: UploadRow;
  userId: string;
  /** processing_started_at written by the claim; scopes every write of this job. */
  startedAt: string;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
  anthropic: Anthropic;
  model: string;
  effort: Effort;
}

const activeJobs = new Map<string, UploadJobWriter>();

/** Best-effort: mark in-flight jobs failed when the worker is about to shut down (wall-clock limit). */
export function failActiveJobs(): void {
  for (const writer of activeJobs.values()) void writer.fail(MESSAGES.shutdown);
  activeJobs.clear();
}

type JobResult = { ok: true; extraction: SyllabusExtraction | TocExtraction } | { ok: false; message: string };

function interpret(kind: UploadRow['kind'], outcome: StructuredOutcome, uploadId: string): JobResult {
  switch (outcome.status) {
    case 'refusal':
      console.warn(`parse-syllabus: upload ${uploadId} refused (${outcome.message.stop_details?.category ?? 'no category'})`);
      return { ok: false, message: MESSAGES.refusal };
    case 'max_tokens':
      return { ok: false, message: MESSAGES.tooLong };
    case 'no_output':
      return { ok: false, message: MESSAGES.unreadable };
  }
  if (kind === 'toc') {
    const parsed = parseStructuredOutput(outcome.text, TocExtraction, OUTPUT_SCHEMAS.toc);
    if (parsed.ok) return { ok: true, extraction: normalizeTocExtraction(parsed.data) };
    console.error(`parse-syllabus: upload ${uploadId} output rejected (${parsed.reason}: ${parsed.detail})`);
    return { ok: false, message: MESSAGES.unreadable };
  }
  const parsed = parseStructuredOutput(outcome.text, SyllabusExtraction, OUTPUT_SCHEMAS.syllabus);
  if (parsed.ok) return { ok: true, extraction: normalizeExtraction(parsed.data) };
  console.error(`parse-syllabus: upload ${uploadId} output rejected (${parsed.reason}: ${parsed.detail})`);
  return { ok: false, message: MESSAGES.unreadable };
}

export async function runParseJob(input: ParseJobInput): Promise<void> {
  const { upload, anthropic } = input;
  const writer = new UploadJobWriter(input.adminClient, upload.id, input.userId, input.startedAt);
  const progress = new ProgressReporter(upload.kind, (note) => writer.note(note));
  const uploadedFileIds: string[] = [];
  activeJobs.set(upload.id, writer);

  try {
    const [timezone, course, content] = await Promise.all([
      loadTimezone(input.userClient, input.userId),
      loadCourseContext(input.userClient, upload.course_id),
      prepareContent({ userClient: input.userClient, anthropic, upload, uploadedFileIds }),
    ]);
    const prompt = buildUserPrompt({
      kind: upload.kind,
      source: upload.source,
      today: localDateISO(timezone),
      timezone,
      course,
      documents: content.documents,
    });

    progress.start();
    const outcome = await requestStructuredOutput(anthropic, {
      model: input.model,
      effort: input.effort,
      system: systemPromptFor(upload.kind),
      content: [...content.blocks, { type: 'text', text: prompt }],
      schema: OUTPUT_SCHEMAS[upload.kind].schema,
      onText: progress.onText,
    });
    await progress.stop();

    const result = interpret(upload.kind, outcome, upload.id);
    if (result.ok) {
      await writer.succeed({
        extraction: result.extraction,
        model: outcome.message.model,
        usage: usageSummary(outcome.message, { requested_model: input.model, effort: input.effort, files_api: content.usedFilesApi }),
      });
    } else {
      await writer.fail(result.message);
    }
  } catch (err) {
    await progress.stop();
    const failure = err instanceof HttpError ? { message: err.message, log: `HttpError ${err.code}` } : describeClaudeError(err);
    console.error(`parse-syllabus: upload ${upload.id} failed (${failure.log})`);
    await writer.fail(failure.message);
  } finally {
    activeJobs.delete(upload.id);
    await deleteClaudeFiles(anthropic, uploadedFileIds);
  }
}
