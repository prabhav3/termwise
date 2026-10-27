// Claude access for edge functions and scripts: one streamed structured-output call, Files API
// helpers, and mapping of SDK errors to messages a student can read. Needs the
// "@anthropic-ai/sdk" import-map entry; uses no Deno globals so scripts can reuse it.

import Anthropic, { toFile } from '@anthropic-ai/sdk';
import type { ErrorCode } from './http.ts';
import type { JsonObject } from './json-schema.ts';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
export type ClaudeContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
export type Effort = NonNullable<Anthropic.Beta.Messages.BetaOutputConfig['effort']>;

export const DEFAULT_PARSE_MODEL = 'claude-opus-5-5';
export const DEFAULT_PARSE_EFFORT: Effort = 'medium';
/** Thinking counts toward max_tokens; a long syllabus extraction plus reasoning fits in 64K. */
export const PARSE_MAX_TOKENS = 64_000;
/** Server-side refusal fallback, `fallbacks: 'default'` form (routes by refusal category). */
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function parseEffort(value: string | undefined | null): Effort {
  const v = value?.trim().toLowerCase();
  return EFFORTS.find((e) => e === v) ?? DEFAULT_PARSE_EFFORT;
}

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2 });
}

export interface StructuredRequest {
  model: string;
  effort: Effort;
  /** Byte-stable system prompt; sent with a cache breakpoint. */
  system: string;
  content: ClaudeContentBlock[];
  /** Sanitized JSON Schema (see json-schema.ts). */
  schema: JsonObject;
  maxTokens?: number;
  /** Called with every streamed text delta and the text so far. */
  onText?: (delta: string, snapshot: string) => void;
  signal?: AbortSignal;
}

export type StructuredOutcome =
  | { status: 'ok'; text: string; message: BetaMessage }
  | { status: 'refusal'; message: BetaMessage }
  | { status: 'max_tokens'; message: BetaMessage }
  | { status: 'no_output'; message: BetaMessage };

/** One streamed structured-output request; checks stop_reason before reading any content. */
export async function requestStructuredOutput(client: Anthropic, req: StructuredRequest): Promise<StructuredOutcome> {
  const stream = client.beta.messages.stream(
    {
      model: req.model,
      max_tokens: req.maxTokens ?? PARSE_MAX_TOKENS,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.content }],
      output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
      betas: [SERVER_SIDE_FALLBACK_BETA],
      fallbacks: 'default',
    },
    { signal: req.signal },
  );
  if (req.onText) stream.on('text', req.onText);
  const message = await stream.finalMessage();

  switch (message.stop_reason) {
    case 'refusal':
      return { status: 'refusal', message };
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return { status: 'max_tokens', message };
  }
  // After a mid-stream fallback the continuation arrives in later text blocks; join them all.
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  return text.trim() ? { status: 'ok', text, message } : { status: 'no_output', message };
}

/** True when a fallback model (not the requested one) produced the response. */
export const servedByFallback = (message: BetaMessage): boolean =>
  (message.usage.iterations ?? []).some((entry) => entry.type === 'fallback_message');

/** Token accounting stored on syllabus_uploads.usage (no content). */
export function usageSummary(message: BetaMessage, extra: { requested_model: string; effort: Effort; files_api: boolean }) {
  const u = message.usage;
  return {
    ...extra,
    served_by: message.model,
    served_by_fallback: servedByFallback(message),
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    thinking_tokens: u.output_tokens_details?.thinking_tokens ?? null,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    stop_reason: message.stop_reason,
  };
}

/** Upload one file for this request; it expires after an hour even if cleanup fails. */
export async function uploadFileForClaude(client: Anthropic, bytes: Uint8Array, name: string, mime: string): Promise<string> {
  const file = await toFile(bytes, name, { type: mime });
  const meta = await client.files.upload({ file, expires_in_seconds: 3600 });
  return meta.id;
}

export async function deleteClaudeFiles(client: Anthropic, fileIds: readonly string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const results = await Promise.allSettled(fileIds.map((id) => client.files.delete(id)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) console.warn(`claude: ${failed} of ${fileIds.length} uploaded file(s) could not be deleted (they expire in 1h)`);
}

export interface FriendlyError {
  code: ErrorCode;
  /** Safe to show the student. */
  message: string;
  /** Safe to log: error class and status only. */
  log: string;
}

/** Map an SDK error to a student-facing message. Order matters: subclasses before their parents. */
export function describeClaudeError(err: unknown): FriendlyError {
  const log = err instanceof Anthropic.APIError ? `${err.name} status=${err.status ?? 'none'}` : err instanceof Error ? err.name : 'unknown';
  if (err instanceof Anthropic.APIUserAbortError) {
    return { code: 'internal', message: 'Reading your syllabus took too long. Please try again.', log };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) {
    return { code: 'upstream_error', message: 'We lost the connection while reading your syllabus. Please try again.', log };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { code: 'rate_limited', message: 'Lots of students are uploading right now. Please try again in a minute.', log };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
    return { code: 'internal', message: 'Syllabus reading is temporarily unavailable. Please try again later.', log };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return {
      code: 'bad_request',
      message: "We couldn't read this file. It may be password-protected, damaged, or too long — try a PDF of just the syllabus pages.",
      log,
    };
  }
  if (err instanceof Anthropic.APIError && err.status === 413) {
    return { code: 'too_large', message: 'This upload is too large to read in one pass. Try uploading only the schedule and grading pages.', log };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return { code: 'upstream_error', message: 'The syllabus reader is overloaded right now. Please try again in a few minutes.', log };
  }
  if (err instanceof Anthropic.APIError) {
    return { code: 'upstream_error', message: 'Something went wrong while reading your syllabus. Please try again.', log };
  }
  return { code: 'internal', message: 'Something went wrong while reading your syllabus. Please try again.', log };
}
