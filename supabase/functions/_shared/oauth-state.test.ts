import { describe, expect, it } from 'vitest';
import {
  appendQuery,
  isAllowedReturnUrl,
  OAUTH_STATE_TTL_SECONDS,
  OAuthStateError,
  oauthRedirectUri,
  signOAuthState,
  verifyOAuthState,
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
});

describe('return URLs', () => {
  it('accepts only app deep links', () => {
    expect(isAllowedReturnUrl('termwise://integrations/calendar')).toBe(true);
    expect(isAllowedReturnUrl('exp://192.168.1.20:8081/--/integrations/calendar')).toBe(true);
    expect(isAllowedReturnUrl('https://evil.example/cb')).toBe(false);
    expect(isAllowedReturnUrl('termwise://')).toBe(false);
    expect(isAllowedReturnUrl('termwise://x\n')).toBe(false);
    expect(isAllowedReturnUrl(42)).toBe(false);
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
