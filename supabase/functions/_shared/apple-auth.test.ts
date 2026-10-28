import { beforeAll, describe, expect, it } from 'vitest';
import {
  appleClientSecret,
  appleCredentials,
  appleIdTokenSubject,
  AppleRequestError,
  appleRevocationStep,
  DEFAULT_APPLE_CLIENT_ID,
  exchangeAppleCode,
  hasAppleIdentity,
  revokeAppleToken,
  type AppleCredentials,
} from './apple-auth.ts';
import { base64UrlToBytes, bytesToBase64, utf8Decode, utf8Encode } from './crypto.ts';

let credentials: AppleCredentials;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const lines = bytesToBase64(pkcs8).match(/.{1,64}/g) ?? [];
  credentials = {
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n'),
    clientId: 'com.prabhav3.termwise',
  };
  publicKey = pair.publicKey;
});

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(utf8Decode(base64UrlToBytes(part))) as Record<string, unknown>;
}

function fakeFetch(status: number, body: unknown, calls: { url: string; form: URLSearchParams }[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body ?? '')) });
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('appleCredentials', () => {
  it('needs team id, key id, and private key; client id defaults to the bundle id', () => {
    const env: Record<string, string> = { APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P' };
    expect(appleCredentials((name) => env[name])).toEqual({ teamId: 'T', keyId: 'K', privateKey: 'P', clientId: DEFAULT_APPLE_CLIENT_ID });
    expect(appleCredentials((name) => ({ ...env, APPLE_CLIENT_ID: 'com.other.app' })[name])?.clientId).toBe('com.other.app');
    expect(appleCredentials((name) => ({ ...env, APPLE_PRIVATE_KEY: '' })[name])).toBeNull();
    expect(appleCredentials(() => undefined)).toBeNull();
  });
});

describe('appleClientSecret', () => {
  it('is an ES256 JWT with the claims Apple requires, signed by the .p8 key', async () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const jwt = await appleClientSecret(credentials, now);
    const [header, payload, signature] = jwt.split('.');
    expect(decodePart(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    const claims = decodePart(payload);
    expect(claims).toMatchObject({ iss: 'TEAM123456', aud: 'https://appleid.apple.com', sub: 'com.prabhav3.termwise', iat: now / 1000 });
    expect(Number(claims.exp) - Number(claims.iat)).toBeGreaterThan(0);
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(15_777_000);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlToBytes(signature),
      utf8Encode(`${header}.${payload}`),
    );
    expect(base64UrlToBytes(signature).length).toBe(64);
    expect(valid).toBe(true);
  });

  it('accepts a PEM stored with literal \\n escapes', async () => {
    const escaped = { ...credentials, privateKey: credentials.privateKey.replace(/\n/g, '\\n') };
    const jwt = await appleClientSecret(escaped);
    expect(jwt.split('.')).toHaveLength(3);
  });
});

describe('Apple token endpoints', () => {
  it('exchanges an authorization code with a fresh client secret', async () => {
    const calls: { url: string; form: URLSearchParams }[] = [];
    const tokens = await exchangeAppleCode(
      credentials,
      'c0de',
      fakeFetch(200, { access_token: 'a', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r', id_token: 'x.y.z' }, calls),
    );
    expect(tokens.refresh_token).toBe('r');
    expect(calls[0].url).toBe('https://appleid.apple.com/auth/token');
    expect(Object.fromEntries(calls[0].form)).toMatchObject({ client_id: 'com.prabhav3.termwise', code: 'c0de', grant_type: 'authorization_code' });
    expect(calls[0].form.get('client_secret')?.split('.')).toHaveLength(3);
    expect(calls[0].form.has('redirect_uri')).toBe(false);
  });

  it('revokes a refresh token and surfaces Apple errors', async () => {
    const calls: { url: string; form: URLSearchParams }[] = [];
    await revokeAppleToken(credentials, 'r', 'refresh_token', fakeFetch(200, undefined, calls));
    expect(calls[0].url).toBe('https://appleid.apple.com/auth/revoke');
    expect(Object.fromEntries(calls[0].form)).toMatchObject({ client_id: 'com.prabhav3.termwise', token: 'r', token_type_hint: 'refresh_token' });

    const failure = revokeAppleToken(credentials, 'r', 'refresh_token', fakeFetch(400, { error: 'invalid_client' }, []));
    await expect(failure).rejects.toBeInstanceOf(AppleRequestError);
    await expect(failure).rejects.toMatchObject({ status: 400, reason: 'invalid_client' });
  });
});

describe('Apple identity checks', () => {
  const idToken = (claims: Record<string, unknown>) =>
    `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

  it('reads the Apple user id from an Apple-issued id_token', () => {
    expect(appleIdTokenSubject(idToken({ iss: 'https://appleid.apple.com', sub: '001234.abc' }))).toBe('001234.abc');
    expect(appleIdTokenSubject(idToken({ iss: 'https://evil.example', sub: '001234.abc' }))).toBeNull();
    expect(appleIdTokenSubject('garbage')).toBeNull();
    expect(appleIdTokenSubject(undefined)).toBeNull();
  });

  it('matches the auth user’s Apple identity', () => {
    const identities = [
      { provider: 'email', id: 'u1' },
      { provider: 'apple', id: '001234.abc', identity_data: { sub: '001234.abc' } },
    ];
    expect(hasAppleIdentity(identities)).toBe(true);
    expect(hasAppleIdentity(identities, '001234.abc')).toBe(true);
    expect(hasAppleIdentity(identities, '009999.zzz')).toBe(false);
    expect(hasAppleIdentity([{ provider: 'email', id: 'u1' }])).toBe(false);
    expect(hasAppleIdentity(undefined)).toBe(false);
  });
});

describe('appleRevocationStep (account deletion)', () => {
  const base = { storedToken: false, authorizationCode: false, skipRequested: false, credentials: true, appleIdentity: true };

  it('asks for re-authorization before deleting an Apple account with no stored token', () => {
    expect(appleRevocationStep(base)).toBe('reauth_required');
  });

  it('revokes with a stored token or a fresh code', () => {
    expect(appleRevocationStep({ ...base, storedToken: true })).toBe('revoke');
    expect(appleRevocationStep({ ...base, authorizationCode: true })).toBe('revoke');
    expect(appleRevocationStep({ ...base, authorizationCode: true, skipRequested: true })).toBe('revoke');
  });

  it('never blocks deletion when revocation is impossible or declined', () => {
    expect(appleRevocationStep({ ...base, skipRequested: true })).toBe('no_token');
    expect(appleRevocationStep({ ...base, credentials: false })).toBe('skipped');
    expect(appleRevocationStep({ ...base, storedToken: true, credentials: false })).toBe('skipped');
    expect(appleRevocationStep({ ...base, appleIdentity: false })).toBe('not_linked');
    expect(appleRevocationStep({ ...base, appleIdentity: false, credentials: false })).toBe('not_linked');
  });
});
