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

3. **Auth → URL Configuration**: Site URL `termwise://`; Redirect URLs `termwise://**` and, for Expo Go
   development, `exp://**`. (Email confirmation and password-reset links open the app.)
4. **Auth → Providers → Apple**: enable it and add Client IDs `com.prabhav3.termwise` (your bundle id) and,
   only while testing in Expo Go, `host.exp.Exponent`. Native Sign in with Apple needs no secret key.
5. Function secrets (generate the two random keys once and keep them; rotating `TOKEN_ENCRYPTION_KEY`
   disconnects every Canvas/Google/Outlook connection):

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase secrets set TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   npx supabase secrets set OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
   # optional calendar sync (step 3):
   npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   npx supabase secrets set MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
   # optional parser tuning (defaults: claude-opus-5-5, medium):
   npx supabase secrets set PARSE_MODEL=claude-opus-5-5 PARSE_EFFORT=medium
   ```

6. Deploy every Edge Function (JWT settings come from `supabase/config.toml`):

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

Expo Go can't use this app's own bundle id, so Sign in with Apple only works there if `host.exp.Exponent` is listed
in the Apple provider (step 2.4). For the real thing, make a development build once (registers your iPhone, builds
in the cloud, installs over the air):

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

Already covered for review: Sign in with Apple alongside email login, in-app account deletion (Settings → Account),
permission strings for calendars, reminders, camera, and photos, and no remote push (local notifications only).
You still need: App Store Connect listing, privacy nutrition labels (account email, uploaded documents, grades you
enter), and a privacy policy URL.
