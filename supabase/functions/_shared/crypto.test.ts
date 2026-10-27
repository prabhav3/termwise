import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  decryptSecret,
  encryptSecret,
  importTokenKey,
  randomBytes,
  SecretFormatError,
  sha256Hex,
  timingSafeEqual,
} from './crypto.ts';

const KEY_B64 = bytesToBase64(new Uint8Array(32).map((_, i) => i * 7));

describe('AES-GCM secret sealing', () => {
  it('round-trips and uses the v1 format with a fresh IV each time', async () => {
    const key = await importTokenKey(KEY_B64);
    const a = await encryptSecret('canvas-token-123 ✓', key);
    const b = await encryptSecret('canvas-token-123 ✓', key);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, key)).toBe('canvas-token-123 ✓');
  });

  it('rejects tampered ciphertext and foreign formats', async () => {
    const key = await importTokenKey(KEY_B64);
    const sealed = await encryptSecret('secret', key);
    const [v, iv, ct] = sealed.split(':');
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const flipped = bytesToBase64(bytes);
    await expect(decryptSecret(`${v}:${iv}:${flipped}`, key)).rejects.toBeInstanceOf(SecretFormatError);
    await expect(decryptSecret('v2:abc:def', key)).rejects.toBeInstanceOf(SecretFormatError);
    await expect(decryptSecret('plaintext', key)).rejects.toBeInstanceOf(SecretFormatError);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => importTokenKey(bytesToBase64(new Uint8Array(16)))).toThrow(SecretFormatError);
  });
});

describe('helpers', () => {
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('round-trips base64url', () => {
    const bytes = randomBytes(33);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    expect(bytesToBase64Url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('compares in constant time', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
