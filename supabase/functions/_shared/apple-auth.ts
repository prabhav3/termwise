// Sign in with Apple REST API (runtime-agnostic): the ES256 client_secret JWT, authorization code
// exchange (POST https://appleid.apple.com/auth/token) and token revocation
// (POST https://appleid.apple.com/auth/revoke). Used by apple-token (store the refresh token after
// sign-in) and account (revoke it on deletion). Credentials are passed in by the functions.
import type { AppleRevocationOutcome } from './api.ts';
import { base64ToBytes, base64UrlToBytes, bytesToBase64Url, utf8Decode, utf8Encode } from './crypto.ts';

const APPLE_ISSUER = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const REQUEST_TIMEOUT_MS = 10_000;
/** client_secret lifetime. Apple allows up to 15777000 s (six months); each request signs a fresh one. */
const CLIENT_SECRET_TTL_SECONDS = 300;

/** The app's bundle id: the client_id of native Sign in with Apple (app.json ios.bundleIdentifier). */
export const DEFAULT_APPLE_CLIENT_ID = 'com.prabhav3.termwise';

export interface AppleCredentials {
  /** 10-character Team ID (the JWT `iss`). */
  teamId: string;
  /** 10-character Key ID of the Sign in with Apple key (the JWT header `kid`). */
  keyId: string;
  /** Contents of the downloaded AuthKey_<keyId>.p8 file (PKCS #8 PEM). */
  privateKey: string;
  /** Bundle id (native apps) — the `client_id` and the JWT `sub`. */
  clientId: string;
}

/**
 * Reads APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY and optional APPLE_CLIENT_ID through `get`.
 * Null when any required value is missing (revocation is then skipped, never fatal).
 */
export function appleCredentials(get: (name: string) => string | undefined): AppleCredentials | null {
  const teamId = get('APPLE_TEAM_ID')?.trim();
  const keyId = get('APPLE_KEY_ID')?.trim();
  const privateKey = get('APPLE_PRIVATE_KEY')?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId: get('APPLE_CLIENT_ID')?.trim() || DEFAULT_APPLE_CLIENT_ID };
}

export class AppleRequestError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`Apple request failed (${status}${reason ? `: ${reason}` : ''})`);
    this.name = 'AppleRequestError';
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Imports the .p8 key. Accepts real newlines or literal "\n" (how some secret stores keep PEMs). */
export function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    const body = pem
      .replace(/\\n/g, '\n')
      .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
    key = crypto.subtle.importKey('pkcs8', base64ToBytes(body), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    keyCache.set(pem, key);
    key.catch(() => keyCache.delete(pem));
  }
  return key;
}

function base64UrlJson(value: unknown): string {
  return bytesToBase64Url(utf8Encode(JSON.stringify(value)));
}

/** The client_secret JWT: ES256, kid = Key ID, iss = Team ID, aud = appleid.apple.com, sub = client_id. */
export async function appleClientSecret(credentials: AppleCredentials, nowMs: number = Date.now()): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const signingInput = `${base64UrlJson({ alg: 'ES256', kid: credentials.keyId })}.${base64UrlJson({
    iss: credentials.teamId,
    iat,
    exp: iat + CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_ISSUER,
    sub: credentials.clientId,
  })}`;
  // Web Crypto's ECDSA output is the raw r || s (IEEE P1363) form JWS expects.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importApplePrivateKey(credentials.privateKey),
    utf8Encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function applePost(url: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppleRequestError(0, 'unreachable');
  }
  const text = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const reason = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null;
    throw new AppleRequestError(response.status, reason);
  }
  return body;
}

export interface AppleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

/** Exchanges a native authorizationCode (single use, valid five minutes). No redirect_uri for native apps. */
export async function exchangeAppleCode(
  credentials: AppleCredentials,
  code: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<AppleTokenResponse> {
  const body = await applePost(
    TOKEN_URL,
    {
      client_id: credentials.clientId,
      client_secret: await appleClientSecret(credentials, nowMs),
      code,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
  if (typeof body !== 'object' || body === null || typeof (body as { access_token?: unknown }).access_token !== 'string') {
    throw new AppleRequestError(200, 'invalid_response');
  }
  return body as AppleTokenResponse;
}

/** Revokes a refresh (or access) token. Apple answers 200 also for tokens that were already invalid. */
export async function revokeAppleToken(
  credentials: AppleCredentials,
  token: string,
  tokenTypeHint: 'refresh_token' | 'access_token' = 'refresh_token',
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<void> {
  await applePost(
    REVOKE_URL,
    {
      client_id: credentials.clientId,
      client_secret: await appleClientSecret(credentials, nowMs),
      token,
      token_type_hint: tokenTypeHint,
    },
    fetchImpl,
  );
}

/**
 * The Apple user id (`sub`) of an id_token that came straight from Apple's token endpoint over
 * TLS (so its signature needs no separate check here). Null when it can't be read.
 */
export function appleIdTokenSubject(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(utf8Decode(base64UrlToBytes(payload))) as { sub?: unknown; iss?: unknown };
    return claims.iss === APPLE_ISSUER && typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

export interface IdentityLike {
  provider: string;
  id?: string;
  identity_data?: Record<string, unknown> | null;
}

export type AppleRevocationStep = 'revoke' | 'reauth_required' | Exclude<AppleRevocationOutcome, 'revoked' | 'failed'>;

/**
 * What account deletion does about Sign in with Apple, decided before anything is deleted:
 * revoke a stored token or one minted from a fresh authorization code; or, for an Apple account
 * with neither while the server could revoke, ask the app to re-authorize first (unless the
 * student chose to skip). `appleIdentity` only matters without a token or code.
 */
export function appleRevocationStep(input: {
  storedToken: boolean;
  authorizationCode: boolean;
  skipRequested: boolean;
  credentials: boolean;
  appleIdentity: boolean;
}): AppleRevocationStep {
  if (input.storedToken || input.authorizationCode) return input.credentials ? 'revoke' : 'skipped';
  if (!input.appleIdentity) return 'not_linked';
  if (!input.credentials) return 'skipped';
  return input.skipRequested ? 'no_token' : 'reauth_required';
}

/** True when the auth user has an Apple identity (optionally: for this Apple user id). */
export function hasAppleIdentity(identities: IdentityLike[] | null | undefined, appleUserId?: string): boolean {
  return (identities ?? []).some(
    (identity) =>
      identity.provider === 'apple' &&
      (appleUserId === undefined || identity.id === appleUserId || identity.identity_data?.sub === appleUserId),
  );
}
