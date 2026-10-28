# Setup, run, and ship

You need: Node 22 or 24 LTS, a Supabase account, an Anthropic API key, an Expo account (free), and —
for running on your own iPhone outside Expo Go, Sign in with Apple, and the App Store — an Apple
Developer account. No Mac is required: iOS builds run in the cloud on EAS.

## 1. Install

```bash
npm install
cp .env.example .env          # then fill in the two values from step 2
```

## 2. Supabase backend

1. Create a project at supabase.com. Copy the **Project URL** and the **publishable key**
   (Project Settings → API Keys) into `.env`.
2. Link the repo and apply the schema (tables, row-level security, storage bucket, share RPCs):

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. **Auth → URL Configuration**: Site URL `termwise://`; Redirect URLs `termwise://**` — nothing else on the
   production project. (Email confirmation and password-reset links open the app.) **Never add `exp://**`
   here**: any `exp://` host would then be an allowed redirect, so a password-reset or sign-in link could be sent
   to an attacker's Expo Go "server" together with its one-time code. For Expo Go development use a separate
   dev Supabase project (or the local stack, `npx supabase start`) and allow-list only your exact dev-server
   origin there, e.g. `exp://192.168.1.20:8081/**`. (`supabase/config.toml` lists `exp://**` for the local stack
   only — don't `supabase config push` its `[auth]` section to the production project.)
4. **Auth → Providers → Apple**: enable it and add Client ID `com.prabhav3.termwise` (your bundle id) — on the
   dev project only, also `host.exp.Exponent` for testing in Expo Go. Native sign-in itself needs no secret key.
5. **Sign in with Apple key (token revocation)**. Apple requires apps that offer Sign in with Apple to revoke the
   user's Apple tokens when they delete their account; the `apple-token` and `account` functions do this with a
   Sign in with Apple private key:
   - Apple Developer → Certificates, Identifiers & Profiles → **Keys** → **+** → enable *Sign in with Apple* →
     Configure → primary App ID `com.prabhav3.termwise` → Save → Register → **download the `.p8`** (only once).
   - Note the **Key ID** (10 characters, on the key's page) and your **Team ID** (Membership details).
   - Set them as secrets in step 6. Without them, account deletion still works and reports that Apple
     revocation was skipped.
6. Function secrets (generate the two random keys once and keep them; rotating `TOKEN_ENCRYPTION_KEY`
   disconnects every Canvas/Google/Outlook connection and makes stored Apple tokens unreadable):

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase secrets set TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   npx supabase secrets set OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
   # Sign in with Apple token revocation (step 5); the .p8 contents, newlines included:
   npx supabase secrets set APPLE_TEAM_ID=ABCDE12345 APPLE_KEY_ID=FGHIJ67890
   npx supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_FGHIJ67890.p8)"
   # optional, only if your bundle id differs from com.prabhav3.termwise:
   npx supabase secrets set APPLE_CLIENT_ID=com.example.termwise
   # optional calendar sync (step 3):
   npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   npx supabase secrets set MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
   # optional parser tuning (defaults: claude-opus-5-5, medium):
   npx supabase secrets set PARSE_MODEL=claude-opus-5-5 PARSE_EFFORT=medium
   ```

   `ALLOW_EXPO_GO_RETURN=1` lets the Google/Outlook connect flow return to `exp://` (Expo Go) links. Set it
   only on a dev project, never on production.

7. Deploy every Edge Function (JWT settings come from `supabase/config.toml`):

   ```bash
   npx supabase functions deploy
   ```

Notes:
- **Parse time limit.** Edge Functions get 150 s of wall clock on the Free plan and 400 s on paid plans.
  Most syllabi parse well inside that; a very long one on Free can time out (the student sees a retry).
  `PARSE_EFFORT=low` is faster; a paid plan gives more headroom.
- **Share-link web previews** (`share-preview`) render as a web page only once the project has a custom domain;
  on the default `*.supabase.co` host Supabase serves HTML as plain text. In-app share links
  (`termwise://share/<slug>`) work regardless.

## 3. Calendar sync (optional)

Apple Calendar / Reminders sync runs on the phone and needs no setup. The iCal subscription feed needs none either.

**Google Calendar + Tasks**
1. Google Cloud console → enable *Google Calendar API* and *Google Tasks API*.
2. OAuth consent screen → External; add yourself as a test user while unverified (calendar scopes need Google's
   verification before public launch).
3. Credentials → OAuth client ID → *Web application*; Authorized redirect URI:
   `https://<your-project-ref>.supabase.co/functions/v1/calendar-oauth-callback`. Put the id/secret in the secrets above.

**Outlook (Microsoft 365 / Outlook.com)**
1. Microsoft Entra admin center → App registrations → New; supported accounts: *any organizational directory and
   personal Microsoft accounts*; platform *Web* with the same redirect URI as Google.
2. Certificates & secrets → new client secret. API permissions (delegated): `offline_access`, `Calendars.ReadWrite`,
   `Tasks.ReadWrite`, `User.Read`.

## 4. Canvas

Nothing to configure server-side. In the app, a student enters their school's Canvas URL and a personal access token
(Canvas → Account → Settings → *New Access Token*). Tokens are encrypted and never leave the server. Some schools
disable student tokens; supporting those needs a Canvas developer key issued by the school (OAuth), which can be added later.

## 5. Run the app

Quickest look (Expo Go app on your iPhone, same Wi-Fi):

```bash
npx expo start
```

Expo Go opens the app through `exp://` links, which the production project deliberately rejects (step 2.3). Point
`.env` at a dev Supabase project whose Redirect URLs include your exact `exp://<your-computer's-ip>:8081/**` origin,
with `ALLOW_EXPO_GO_RETURN=1` set there if you want to try Google/Outlook connect from Expo Go. Expo Go can't use this
app's own bundle id, so Sign in with Apple only works there if `host.exp.Exponent` is listed in that project's Apple
provider (step 2.4), and its tokens can't be stored for revocation. For the real thing, make a development build
once (registers your iPhone, builds in the cloud, installs over the air):

```bash
npx eas-cli@latest login
npx eas-cli@latest device:create
npx eas-cli@latest build --profile development --platform ios
npx expo start --dev-client
```

## 6. Checks

```bash
npm run typecheck        # app TypeScript
npm test                 # engine + shared logic (vitest)
npm run check:db         # migrations + RLS smoke tests on in-memory Postgres (PGlite)
npm run check:functions  # Deno type-check of every Edge Function
npx eslint src           # lint
npm run check:bundle     # Metro iOS bundle
```

Live parser smoke test (calls Claude, costs a few cents):

```bash
ANTHROPIC_API_KEY=sk-ant-... npx deno run --allow-env --allow-net --config supabase/functions/parse-syllabus/deno.json scripts/smoke-parse.ts
```

## 7. Ship to the App Store

```bash
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --platform ios
```

Already covered for review: Sign in with Apple alongside email login, in-app account deletion (Settings → Account) that
also revokes the student's Sign in with Apple tokens (needs the Apple key from step 2.5),
permission strings for calendars, reminders, camera, and photos, and no remote push (local notifications only).
You still need: App Store Connect listing, privacy nutrition labels (account email, uploaded documents, grades you
enter), and a privacy policy URL.
