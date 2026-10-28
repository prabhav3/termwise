import { describe, expect, it } from 'vitest';
import {
  appendQuery,
  createFinishCode,
  createPkcePair,
  hashFinishCode,
  isAllowedReturnUrl,
  isFinishCode,
  issueOAuthState,
  OAUTH_STATE_TTL_SECONDS,
  OAuthStateError,
  oauthRedirectUri,
  pendingFinishFailure,
  pkceChallenge,
  signOAuthState,
  verifyOAuthState,
  withCodeChallenge,
} from './oauth-state.ts';

const SECRET = 'test-oauth-state-secret-0123456789';
const input = { uid: '7f1c0c1e-1111-4222-8333-944445555666', provider: 'google' as const, return_url: 'termwise://integrations/calendar' };

describe('OAuth state', () => {
  it('round-trips the payload with a nonce and a 10 minute expiry', async () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const token = await signOAuthState(input, SECRET, now);
    const state = await verifyOAuthState(token, SECRET, now + 60_000);
    expect(state).toMatchObject(input);
    expect(state.nonce.length).toBeGreaterThan(10);
    expect(state.exp).toBe(now / 1000 + OAUTH_STATE_TTL_SECONDS);
  });

  it('issues the payload alongside the token so start can key the pending row by its nonce', async () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const issued = await issueOAuthState(input, SECRET, now);
    const verified = await verifyOAuthState(issued.token, SECRET, now);
    expect(verified).toEqual(issued.state);
    const other = await issueOAuthState(input, SECRET, now);
    expect(other.state.nonce).not.toBe(issued.state.nonce);
  });

  it('rejects expired, tampered, and malformed state', async () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const token = await signOAuthState(input, SECRET, now);
    await expect(verifyOAuthState(token, SECRET, now + 11 * 60_000)).rejects.toMatchObject({ reason: 'expired' });

    const [body, sig] = token.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    forged.uid = 'someone-else';
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString('base64url');
    await expect(verifyOAuthState(`${forgedBody}.${sig}`, SECRET, now)).rejects.toMatchObject({ reason: 'bad_signature' });
    await expect(verifyOAuthState(token, `${SECRET}-other`, now)).rejects.toMatchObject({ reason: 'bad_signature' });
    await expect(verifyOAuthState('garbage', SECRET, now)).rejects.toBeInstanceOf(OAuthStateError);
    await expect(verifyOAuthState('a.b.c', SECRET, now)).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('rejects an Expo Go return URL unless the dev-only policy allows it', async () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const token = await signOAuthState({ ...input, return_url: 'exp://127.0.0.1:8081/--/integrations/calendar' }, SECRET, now);
    await expect(verifyOAuthState(token, SECRET, now)).rejects.toMatchObject({ reason: 'malformed' });
    await expect(verifyOAuthState(token, SECRET, now, { allowExpoGo: true })).resolves.toMatchObject({ provider: 'google' });
  });
});

describe('return URLs', () => {
  it('accepts only app deep links by default', () => {
    expect(isAllowedReturnUrl('termwise://integrations/calendar')).toBe(true);
    expect(isAllowedReturnUrl('exp://192.168.1.20:8081/--/integrations/calendar')).toBe(false);
    expect(isAllowedReturnUrl('exp://attacker.example/x')).toBe(false);
    expect(isAllowedReturnUrl('https://evil.example/cb')).toBe(false);
    expect(isAllowedReturnUrl('termwise://')).toBe(false);
    expect(isAllowedReturnUrl('termwise://x\n')).toBe(false);
    expect(isAllowedReturnUrl(42)).toBe(false);
  });

  it('accepts Expo Go links only with allowExpoGo (ALLOW_EXPO_GO_RETURN=1)', () => {
    expect(isAllowedReturnUrl('exp://192.168.1.20:8081/--/integrations/calendar', { allowExpoGo: true })).toBe(true);
    expect(isAllowedReturnUrl('termwise://integrations/calendar', { allowExpoGo: true })).toBe(true);
    expect(isAllowedReturnUrl('exp://', { allowExpoGo: true })).toBe(false);
    expect(isAllowedReturnUrl('https://evil.example/cb', { allowExpoGo: true })).toBe(false);
  });

  it('appends query parameters to custom-scheme URLs', () => {
    expect(appendQuery('termwise://integrations/calendar', { status: 'connected', provider: 'google' })).toBe(
      'termwise://integrations/calendar?status=connected&provider=google',
    );
    expect(appendQuery('termwise://x?tab=1#top', { status: 'error', message: 'Try again' })).toBe(
      'termwise://x?tab=1&status=error&message=Try+again#top',
    );
  });
});

describe('redirect URI', () => {
  it('points at the callback function', () => {
    expect(oauthRedirectUri('https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1/calendar-oauth-callback');
    expect(oauthRedirectUri('https://abc.supabase.co')).toBe('https://abc.supabase.co/functions/v1/calendar-oauth-callback');
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a 43-character verifier with its S256 challenge', async () => {
    const pair = await createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).toBe(await pkceChallenge(pair.verifier));
    expect((await createPkcePair()).verifier).not.toBe(pair.verifier);
  });

  it('adds the challenge to a consent URL without dropping its parameters', () => {
    const url = new URL(withCodeChallenge('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&state=s.t', 'CHALLENGE'));
    expect(url.searchParams.get('client_id')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('s.t');
    expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('finish codes', () => {
  it('are random, well-formed, and stored only as a SHA-256 hash', async () => {
    const code = createFinishCode();
    expect(isFinishCode(code)).toBe(true);
    expect(createFinishCode()).not.toBe(code);
    expect(isFinishCode('short')).toBe(false);
    expect(isFinishCode(`${code.slice(0, 42)}.`)).toBe(false);
    expect(isFinishCode(42)).toBe(false);
    const hash = await hashFinishCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
  });

  it('let only the account that started the flow finish it', () => {
    const now = Date.UTC(2026, 9, 27, 12);
    const row = { user_id: input.uid, expires_at: new Date(now + 60_000).toISOString(), access_token_enc: 'v1:iv:ct' };
    expect(pendingFinishFailure(row, input.uid, now)).toBeNull();
    // The victim's app finishing an attacker-started flow (or vice versa) is refused.
    expect(pendingFinishFailure(row, '00000000-0000-4000-8000-000000000000', now)).toBe('wrong_account');
    expect(pendingFinishFailure(null, input.uid, now)).toBe('missing');
    expect(pendingFinishFailure({ ...row, expires_at: new Date(now - 1).toISOString() }, input.uid, now)).toBe('expired');
    expect(pendingFinishFailure({ ...row, expires_at: 'not a date' }, input.uid, now)).toBe('expired');
    expect(pendingFinishFailure({ ...row, access_token_enc: null }, input.uid, now)).toBe('incomplete');
  });
});
