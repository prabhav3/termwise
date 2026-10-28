// HTTP helpers shared by every Edge Function (Deno only — the app never imports this file).
import type { ApiError } from './api.ts';

export type ErrorCode = ApiError['error']['code'];

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  upstream_auth: 424,
  upstream_error: 502,
  rate_limited: 429,
  too_large: 413,
  unsupported_file: 415,
  ai_refused: 422,
  apple_reauth_required: 409,
  internal: 500,
};

/** Throw from anywhere in a handler; `handle()` turns it into an ApiError response. */
export class HttpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = STATUS[code],
  ) {
    super(message);
  }
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers },
  });
}

export function errorResponse(code: ErrorCode, message: string, status = STATUS[code]): Response {
  const body: ApiError = { error: { code, message } };
  return json(body, status);
}

/** Parse a JSON body or throw a 400. */
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError('bad_request', 'Request body must be JSON.');
  }
}

/**
 * Wrap a handler: answers CORS preflight, converts HttpError to ApiError JSON, and hides
 * unexpected errors behind a generic message (logged without request bodies or tokens).
 */
export function handle<C>(
  fn: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.code, err.message, err.status);
      console.error('unhandled error', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return errorResponse('internal', 'Something went wrong. Please try again.');
    }
  };
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError('internal', `Server is missing configuration (${name}).`);
  return value;
}
