import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { appleAccessMayRemain, usesAppleSignIn } from './apple-identity';

type UserParts = Pick<User, 'identities' | 'app_metadata'>;

const identity = (provider: string) => ({ provider }) as NonNullable<User['identities']>[number];

describe('usesAppleSignIn', () => {
  it('is true for an Apple identity', () => {
    expect(usesAppleSignIn({ identities: [identity('email'), identity('apple')], app_metadata: {} } as UserParts)).toBe(true);
  });

  it('falls back to app_metadata when identities are missing from the session', () => {
    expect(usesAppleSignIn({ app_metadata: { provider: 'apple' } } as UserParts)).toBe(true);
    expect(usesAppleSignIn({ app_metadata: { provider: 'email', providers: ['email', 'apple'] } } as UserParts)).toBe(true);
  });

  it('is false for email-only accounts and no user', () => {
    expect(usesAppleSignIn({ identities: [identity('email')], app_metadata: { provider: 'email', providers: ['email'] } } as UserParts)).toBe(false);
    expect(usesAppleSignIn({ app_metadata: {} } as UserParts)).toBe(false);
    expect(usesAppleSignIn(null)).toBe(false);
  });
});

describe('appleAccessMayRemain', () => {
  it('warns an Apple account whenever its access was not revoked', () => {
    expect(appleAccessMayRemain('no_token', true)).toBe(true);
    expect(appleAccessMayRemain('failed', true)).toBe(true);
    expect(appleAccessMayRemain('skipped', true)).toBe(true);
  });

  it('stays quiet when revoked, or for accounts that never used Apple', () => {
    expect(appleAccessMayRemain('revoked', true)).toBe(false);
    expect(appleAccessMayRemain('not_linked', false)).toBe(false);
    expect(appleAccessMayRemain('skipped', false)).toBe(false);
    expect(appleAccessMayRemain('failed', false)).toBe(false);
  });
});
