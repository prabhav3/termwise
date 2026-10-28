// Signed, expiring OAuth `state` for the Google / Microsoft calendar consent flow, plus the PKCE
// and one-time "finish" codes that tie a consent back to the Termwise account that started it.
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part)).
//
// Flow: calendar-oauth-start stores a pending row (nonce, uid, provider, PKCE verifier) and sends
// the S256 challenge; calendar-oauth-callback accepts a state only once, for a pending row it
// issued, exchanges the code with the verifier, parks the sealed tokens on that row, and hands the
// app a one-time finish code; calendar-oauth-finish (user auth) creates the connection only when
// the signed-in caller is the account that started the flow.
import type { CloudCalendarProvider } from './api.ts';
import { base64UrlToBytes, bytesToBase64Url, randomId, sha256Hex, utf8Decode, utf8Encode } from './crypto.ts';

export const OAUTH_STATE_TTL_SECONDS = 600;
/** How long the app has to call calendar-oauth-finish after the provider redirects back. */
export const OAUTH_FINISH_TTL_SECONDS = 300;

export interface OAuthState {
  uid: string;
  provider: CloudCalendarProvider;
  return_url: string;
  nonce: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export type OAuthStateFailure = 'malformed' | 'bad_signature' | 'expired';

export class OAuthStateError extends Error {
  constructor(readonly reason: OAuthStateFailure) {
    super(`OAuth state rejected: ${reason}`);
    this.name = 'OAuthStateError';
  }
}

export interface ReturnUrlPolicy {
  /**
   * Also accept exp:// (Expo Go) deep links. Development only: the functions turn this on when
   * ALLOW_EXPO_GO_RETURN=1, which must never be set on the production project.
   */
  allowExpoGo?: boolean;
}

const APP_PREFIX = 'termwise://';
const EXPO_GO_PREFIX = 'exp://';

/** Only deep links back into the app (or Expo Go, when the policy allows it) are accepted. */
export function isAllowedReturnUrl(url: unknown, policy: ReturnUrlPolicy = {}): url is string {
  if (typeof url !== 'string' || url.length > 512) return false;
  // Whitespace and control characters could smuggle extra headers or URL parts.
  // deno-lint-ignore no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  const prefixes = policy.allowExpoGo ? [APP_PREFIX, EXPO_GO_PREFIX] : [APP_PREFIX];
  return prefixes.some((prefix) => url.startsWith(prefix) && url.length > prefix.length);
}

/** Appends query parameters to a URL that may use a custom scheme and may already carry a query. */
export function appendQuery(url: string, params: Record<string, string>): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const query = new URLSearchParams(params).toString();
  if (!query) return url;
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${query}${hash}`;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', utf8Encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

/** Signs a fresh state and returns it with its payload (the nonce keys the pending row). */
export async function issueOAuthState(
  input: Pick<OAuthState, 'uid' | 'provider' | 'return_url'>,
  secret: string,
  nowMs: number = Date.now(),
): Promise<{ token: string; state: OAuthState }> {
  if (secret.length < 16) throw new Error('OAUTH_STATE_SECRET must be at least 16 characters.');
  const state: OAuthState = {
    uid: input.uid,
    provider: input.provider,
    return_url: input.return_url,
    nonce: randomId(16),
    exp: Math.floor(nowMs / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const body = bytesToBase64Url(utf8Encode(JSON.stringify(state)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8Encode(body)));
  return { token: `${body}.${bytesToBase64Url(signature)}`, state };
}

export async function signOAuthState(
  input: Pick<OAuthState, 'uid' | 'provider' | 'return_url'>,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  return (await issueOAuthState(input, secret, nowMs)).token;
}

function isOAuthState(value: unknown, policy: ReturnUrlPolicy): value is OAuthState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === 'string' &&
    v.uid.length > 0 &&
    (v.provider === 'google' || v.provider === 'microsoft') &&
    isAllowedReturnUrl(v.return_url, policy) &&
    typeof v.nonce === 'string' &&
    v.nonce.length > 0 &&
    typeof v.exp === 'number' &&
    Number.isFinite(v.exp)
  );
}

/**
 * Checks the signature, shape, and expiry. This alone does not make a state usable: the callback
 * must also claim the pending row for `nonce` (once) before trusting it.
 */
export async function verifyOAuthState(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
  policy: ReturnUrlPolicy = {},
): Promise<OAuthState> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new OAuthStateError('malformed');
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64UrlToBytes(parts[1]);
  } catch {
    throw new OAuthStateError('malformed');
  }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, utf8Encode(parts[0]));
  if (!valid) throw new OAuthStateError('bad_signature');

  let payload: unknown;
  try {
    payload = JSON.parse(utf8Decode(base64UrlToBytes(parts[0])));
  } catch {
    throw new OAuthStateError('malformed');
  }
  if (!isOAuthState(payload, policy)) throw new OAuthStateError('malformed');
  if (payload.exp * 1000 < nowMs) throw new OAuthStateError('expired');
  return payload;
}

/** The redirect URI registered with Google and Microsoft: the callback function's public URL. */
export function oauthRedirectUri(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/calendar-oauth-callback`;
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256)
// ---------------------------------------------------------------------------

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Encode(verifier)));
  return bytesToBase64Url(digest);
}

/** A 43-character verifier (256 random bits, base64url) and its S256 challenge. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomId(32);
  return { verifier, challenge: await pkceChallenge(verifier) };
}

/** Adds the S256 challenge to a Google / Microsoft consent URL. */
export function withCodeChallenge(authUrl: string, challenge: string): string {
  const url = new URL(authUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

// ---------------------------------------------------------------------------
// One-time finish code (callback -> app -> calendar-oauth-finish)
// ---------------------------------------------------------------------------

/**
 * A fresh finish code. It reaches only the browser that completed consent (via return_url) and is
 * never part of the auth URL, so whoever started the flow can't learn it by reading the state.
 */
export function createFinishCode(): string {
  return randomId(32);
}

export function isFinishCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The server keeps only this hash of the finish code. */
export function hashFinishCode(code: string): Promise<string> {
  return sha256Hex(code);
}

export interface PendingAuthorization {
  user_id: string;
  expires_at: string;
  access_token_enc: string | null;
}

export type PendingFinishFailure = 'missing' | 'wrong_account' | 'expired' | 'incomplete';

/**
 * Why a claimed pending row must not become a connection for `callerId`, or null when it may.
 * Only the account that started the flow can finish it.
 */
export function pendingFinishFailure(
  row: PendingAuthorization | null,
  callerId: string,
  nowMs: number = Date.now(),
): PendingFinishFailure | null {
  if (!row) return 'missing';
  if (row.user_id !== callerId) return 'wrong_account';
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= nowMs) return 'expired';
  if (!row.access_token_enc) return 'incomplete';
  return null;
}
