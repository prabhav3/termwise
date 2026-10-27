// Signed, expiring OAuth `state` for the Google / Microsoft calendar consent flow.
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part)).
// The callback trusts `uid` and `return_url` only after the signature and expiry check.
import type { CloudCalendarProvider } from './api.ts';
import { base64UrlToBytes, bytesToBase64Url, randomId, utf8Decode, utf8Encode } from './crypto.ts';

export const OAUTH_STATE_TTL_SECONDS = 600;

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

const RETURN_URL_PREFIXES = ['termwise://', 'exp://'];

/** Only deep links back into the app (or Expo Go during development) are accepted. */
export function isAllowedReturnUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 512) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  return RETURN_URL_PREFIXES.some((prefix) => url.startsWith(prefix) && url.length > prefix.length);
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

export async function signOAuthState(
  input: Pick<OAuthState, 'uid' | 'provider' | 'return_url'>,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  if (secret.length < 16) throw new Error('OAUTH_STATE_SECRET must be at least 16 characters.');
  const payload: OAuthState = {
    uid: input.uid,
    provider: input.provider,
    return_url: input.return_url,
    nonce: randomId(12),
    exp: Math.floor(nowMs / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const body = bytesToBase64Url(utf8Encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8Encode(body)));
  return `${body}.${bytesToBase64Url(signature)}`;
}

function isOAuthState(value: unknown): value is OAuthState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === 'string' &&
    v.uid.length > 0 &&
    (v.provider === 'google' || v.provider === 'microsoft') &&
    isAllowedReturnUrl(v.return_url) &&
    typeof v.nonce === 'string' &&
    typeof v.exp === 'number' &&
    Number.isFinite(v.exp)
  );
}

export async function verifyOAuthState(token: string, secret: string, nowMs: number = Date.now()): Promise<OAuthState> {
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
  if (!isOAuthState(payload)) throw new OAuthStateError('malformed');
  if (payload.exp * 1000 < nowMs) throw new OAuthStateError('expired');
  return payload;
}
