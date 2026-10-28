# Termwise architecture

iOS app (Expo SDK 58, React Native 0.88, Expo Router, TypeScript strict) + Supabase (Postgres, Auth,
Storage, Realtime, Edge Functions on Deno) + Claude (`claude-opus-5-5`) for document parsing.

```
termwise/
  src/
    app/                    Expo Router routes ONLY (screens + _layout files)
    components/ui/          neo-brutalist UI kit (docs/DESIGN.md)
    components/<feature>/   feature components (today/, plan/, courses/, review/, grades/, integrations/)
    theme/                  tokens, ThemeProvider, useTheme(), fonts
    engine/                 pure scheduling & grading engine (docs/ENGINE.md) + vitest tests
    data/                   TanStack Query hooks per table (queries + mutations), query keys
    lib/                    supabase client, auth, typed edge-function wrappers, planner glue,
                            notifications, apple calendar, uploads, importers
    types/db.ts             row types = exact DB columns (snake_case)
  supabase/
    migrations/             SQL (schema + RLS + RPCs + storage)  -> npm run check:db
    functions/
      _shared/              runtime-agnostic TS shared with the app: extraction.ts, api.ts, match.ts
                            + Deno-only helpers (http.ts, crypto.ts, ics.ts, claude.ts, ...)
      <name>/index.ts       one folder per function, each with its own deno.json
    config.toml
  docs/                     ARCHITECTURE.md, ENGINE.md, DESIGN.md, SETUP.md
  scripts/                  check-migrations.mjs, check-functions.mjs
```

## Rules every contributor follows

1. **Contracts are fixed**: `src/types/db.ts`, `src/engine/types.ts` + engine export names,
   `supabase/functions/_shared/extraction.ts`, `supabase/functions/_shared/api.ts`, and the migration.
   Need a change? Make the smallest additive change and say so in your report — never rename or remove.
2. **No package installs** while parallel work is running (it corrupts package.json / the lockfile).
   Installed already: supabase-js, async-storage, url-polyfill, @tanstack/react-query, zustand, zod, date-fns,
   expo-document-picker, expo-image-picker, expo-image-manipulator, expo-file-system, expo-calendar,
   expo-notifications, expo-auth-session, expo-crypto, expo-apple-authentication, expo-secure-store,
   expo-haptics, expo-clipboard, expo-keep-awake, expo-localization, react-native-svg,
   @react-native-community/datetimepicker, expo-symbols, expo-image, expo-web-browser, expo-linking,
   @expo-google-fonts/space-grotesk, @expo-google-fonts/archivo-black; dev: vitest, @electric-sql/pglite, deno.
   If you truly need another package, stop and report it instead of installing.
3. **Expo APIs change every SDK**: before using any Expo/RN module, fetch its SDK 58 docs
   (`https://docs.expo.dev/versions/v58.0.0/sdk/<module>/`, index at https://docs.expo.dev/llms.txt).
   Supabase: fetch current docs (Edge Functions now use `npm:@supabase/server@1` `withSupabase` and
   `export default { fetch }`).
4. **Imports**: app code uses `@/…` for `src/…` and `@shared/…` for `supabase/functions/_shared/…`
   (with the `.ts` extension, e.g. `import { SyllabusExtraction } from '@shared/extraction.ts'`).
   Files in `_shared` that the app imports must import nothing except `zod` and each other via `./x.ts`.
5. **Dates**: the student's calendar is local `YYYY-MM-DD` / `HH:MM` strings in `profiles.timezone`.
   Compute "today" once via `src/lib/dates.ts` `todayISO(timezone)`; never `new Date().toISOString().slice(0,10)`.
6. **Security**: RLS everywhere; tokens for Canvas/Google/Microsoft are AES-GCM encrypted
   (`TOKEN_ENCRYPTION_KEY` secret) in `*_secrets` tables that only the service role can read; the Anthropic key
   lives only in Edge Function secrets; never log tokens or document contents.
7. **Styling**: only theme tokens and UI-kit components (docs/DESIGN.md). Light + dark everywhere.
8. **Quality gates** before you report done: `npm run typecheck` (app), `npm test` (engine + shared),
   `npm run check:functions` (Deno), `npm run check:db` (SQL). Fix what you broke; report what you could not.

## Data flow

1. **Capture** — the student picks PDF / DOCX / photos (camera or library, converted to JPEG ≤ 2000 px with
   expo-image-manipulator) / pasted text. The app creates a `syllabus_uploads` row, uploads files to
   `syllabi/<uid>/<upload_id>/<n>.<ext>`, then calls `parse-syllabus`.
2. **Parse** — `parse-syllabus` returns 202 at once and keeps working via `EdgeRuntime.waitUntil`: downloads the
   files, builds Claude content blocks (PDF → `document`, images → `image`, DOCX → mammoth HTML → text, text →
   text), calls Claude with structured output = `SyllabusExtraction` (or `TocExtraction` for a textbook
   table-of-contents photo), runs `normalizeExtraction`, stores it, sets `needs_review` (or `failed` with a friendly
   error). The app watches the row via Realtime with a polling fallback.
3. **Review** — the student checks and edits everything (course info, grading weights, items, readings, term
   events), sees warnings, and can add or remove anything by hand. Import writes courses, components, items,
   textbooks, and term events, then triggers a replan.
4. **Canvas** — connect with a base URL and personal access token → pick courses → import (assignment groups →
   grading components with `group_weight`, assignments → items with due/lock/unlock dates and points, submissions →
   scores) or link to a course that came from a syllabus. Optionally fetch the Canvas syllabus page into the parser.
   Sync re-pulls and writes `lms_discrepancies` (date mismatch, lock before due, missing on either side, weights).
5. **Plan** — `src/lib/planner.ts` `replan()` loads the student's data, runs `buildPlan`, and persists the diff
   (deletes engine `planned` blocks dated ≥ today, upserts the rest by `key`). Runs after imports, edits, completing or
   missing blocks, settings changes, and on app foreground once per day. Then reschedules the next 7 morning triage
   notifications.
6. **Dashboards** — Today (triage top 3, today's blocks, start focus), Plan (weekly stress strip, red zones, master
   calendar across all courses), Courses, Grades (current grade, what-do-I-need, scenario simulator).
7. **Sync out** — Apple Calendar/Reminders on-device via expo-calendar; Google/Outlook via `calendar-oauth-*` +
   `calendar-sync` (two-way: pushed into a dedicated "Termwise" calendar or task list; date edits made there come back
   as `items.external_change` for the student to accept or reject); any calendar via the `ics-feed` subscription URL.
8. **Share** — `rpc('create_share_link')` → `termwise://share/<slug>` + web preview
   (`/functions/v1/share-preview?slug=`). Classmates open it and `rpc('import_shared_timeline')` clones the course
   without anyone's grades.

## Edge Functions

| Function | Auth | Purpose |
|---|---|---|
| `parse-syllabus` | user | AI extraction job (Claude) |
| `calendar-oauth-start` | user | Build Google/Microsoft consent URL (signed state + PKCE); store a one-time pending row |
| `calendar-oauth-callback` | none (verify_jwt off) | Claim the pending row once, exchange the code (PKCE), park encrypted tokens, redirect to app with a one-time `pending` code |
| `calendar-oauth-finish` | user | Turn the `pending` code into the connection — only for the account that started the flow |
| `calendar-sync` | user | Two-way Google Calendar/Tasks + Microsoft Graph Calendar/To Do sync |
| `ics-feed` | none (token in URL) | Read-only iCal subscription feed |
| `canvas` | user | Canvas connect / list / import / sync / fetch_syllabus / disconnect |
| `lms-sync` | user | iCal feeds from Blackboard / Moodle / any LMS → discrepancies |
| `share-preview` | none | HTML preview for share links |
| `account` | user | Delete account (storage, Sign in with Apple token revocation, auth user) |
| `apple-token` | user | After Sign in with Apple: exchange the authorizationCode, keep the encrypted refresh token for revocation |

Request/response types: `supabase/functions/_shared/api.ts`. Secrets: `ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY`
(32-byte base64), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`OAUTH_STATE_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8` key; Sign in with Apple token
revocation is skipped without them), optional `APPLE_CLIENT_ID` (default: the bundle id), `PARSE_MODEL` (default
`claude-opus-5-5`) and `PARSE_EFFORT` (default `medium`). Development only: `ALLOW_EXPO_GO_RETURN=1` lets the calendar
OAuth flow return to `exp://` (Expo Go) links — never set it on the production project.

## App routes (src/app)

```
_layout.tsx                 providers (Theme, QueryClient, Auth), fonts, Stack with Stack.Protected guards
(auth)/sign-in.tsx, sign-up.tsx, forgot-password.tsx
onboarding.tsx              study days, daily capacity, reading speed, triage time, notifications
(tabs)/_layout.tsx          NativeTabs: Today · Plan · Courses · Grades · Settings
(tabs)/index.tsx            Today
(tabs)/plan.tsx             Red-zone dashboard + master calendar
(tabs)/courses.tsx          Course list + add (upload / Canvas / manual)
(tabs)/grades.tsx           Grades overview
(tabs)/settings.tsx         Preferences, integrations entry, account
upload.tsx                  modal: pick files / camera / paste -> parse
review/[uploadId].tsx       review & edit extraction -> import
course/[id].tsx             course detail (items, weights, textbooks, share, Canvas link)
course/edit.tsx             create/edit course manually (?id=)
item/[id].tsx               item detail: edit, done/missed, score, external change review
item/new.tsx                manual item (?courseId=)
textbook/[id].tsx           chapter page map (manual or TOC photo)
grades/[courseId].tsx       grade tracker + what-do-I-need + simulator
week/[start].tsx            one week: stress drivers, red zones, day loads
focus.tsx                   pomodoro (?blockKey=)
integrations/index.tsx      calendars + LMS hub
integrations/calendar.tsx   Apple / Google / Outlook / iCal feed
integrations/canvas.tsx     connect + course picker + sync + discrepancies
integrations/lms.tsx        iCal feed LMS (Blackboard/Moodle/other)
discrepancies.tsx           all open LMS discrepancies
share/[slug].tsx            import a shared timeline (deep link)
```
