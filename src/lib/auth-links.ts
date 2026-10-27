// Email links from Supabase Auth (sign-up confirmation, password reset) open the app with a
// PKCE `?code=` (or `?error_description=` when the link expired). Exchanging the code signs the
// student in on this device.
import { supabase } from './supabase';

export type AuthLinkResult = { ok: true } | { ok: false; message: string };

export async function exchangeAuthCode(params: {
  code?: string | string[];
  error_description?: string | string[];
}): Promise<AuthLinkResult> {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const linkError = first(params.error_description);
  if (linkError) return { ok: false, message: linkError.replace(/\+/g, ' ') };

  const code = first(params.code);
  if (!code) {
    // Opened without a code: fine when a session already exists (e.g. the link was used twice).
    const { data } = await supabase.auth.getSession();
    return data.session ? { ok: true } : { ok: false, message: 'This link is missing its sign-in code.' };
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return {
      ok: false,
      message:
        'This link has expired or was opened on a different device. Request a new one from the same phone you use Termwise on.',
    };
  }
  return { ok: true };
}
