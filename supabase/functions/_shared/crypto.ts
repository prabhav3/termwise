// Web Crypto helpers for the edge functions: AES-256-GCM secret sealing for provider tokens,
// SHA-256 hashing, base64 codecs, and random identifiers. Runtime-agnostic (Deno and Node ≥ 20):
// the key is passed in by the caller (functions read TOKEN_ENCRYPTION_KEY via requireEnv).
//
// Sealed format: "v1:<base64 iv (12 bytes)>:<base64 ciphertext+tag>".

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SEALED_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretFormatError';
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(base64.trim());
  } catch {
    throw new SecretFormatError('Invalid base64 input.');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(base64url)) throw new SecretFormatError('Invalid base64url input.');
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  // TextEncoder output is always backed by a plain ArrayBuffer.
  return encoder.encode(text) as Uint8Array<ArrayBuffer>;
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** URL-safe random identifier (default 128 bits). */
export function randomId(byteLength = 16): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Encode(text)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

let cachedKey: { source: string; key: Promise<CryptoKey> } | null = null;

/**
 * Imports the AES-256-GCM key from its base64 form (TOKEN_ENCRYPTION_KEY). The imported key is
 * cached for the lifetime of the isolate.
 */
export function importTokenKey(base64Key: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.source === base64Key) return cachedKey.key;
  const raw = base64ToBytes(base64Key);
  if (raw.length !== KEY_BYTES) {
    throw new SecretFormatError(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes.`);
  }
  const key = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cachedKey = { source: base64Key, key };
  return key;
}

export async function encryptSecret(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8Encode(plaintext));
  return `${SEALED_VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(sealed))}`;
}

export async function decryptSecret(payload: string, key: CryptoKey): Promise<string> {
  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== SEALED_VERSION) {
    throw new SecretFormatError('Unsupported sealed secret format.');
  }
  const iv = base64ToBytes(parts[1]);
  if (iv.length !== IV_BYTES) throw new SecretFormatError('Sealed secret has an invalid IV.');
  const ciphertext = base64ToBytes(parts[2]);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return utf8Decode(new Uint8Array(plain));
  } catch {
    throw new SecretFormatError('Sealed secret failed authentication.');
  }
}

/** Constant-time comparison for equal-length byte strings. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
