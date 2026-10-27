// Sealing provider tokens with TOKEN_ENCRYPTION_KEY (Deno only: reads the function's secrets).
// The format and cipher live in crypto.ts; this adds the key lookup and safe error mapping.
import { decryptSecret, encryptSecret, importTokenKey, SecretFormatError } from './crypto.ts';
import { HttpError, requireEnv } from './http.ts';

async function tokenKey(): Promise<CryptoKey> {
  try {
    return await importTokenKey(requireEnv('TOKEN_ENCRYPTION_KEY'));
  } catch (err) {
    if (err instanceof SecretFormatError) throw new HttpError('internal', 'Server is misconfigured (TOKEN_ENCRYPTION_KEY).');
    throw err;
  }
}

export async function sealSecret(plaintext: string): Promise<string> {
  return encryptSecret(plaintext, await tokenKey());
}

/** The plaintext, or null when the sealed value is missing or can no longer be decrypted. */
export async function openSecret(sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const key = await tokenKey();
  try {
    return await decryptSecret(sealed, key);
  } catch (err) {
    if (err instanceof SecretFormatError) return null;
    throw err;
  }
}
