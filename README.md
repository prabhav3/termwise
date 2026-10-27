# Termwise

**Drop in every syllabus. Get a semester you can actually survive.**

Professors hand out 15-page syllabi with reading schedules, pop-quiz warnings, and papers that all land the same
week. Termwise reads them for you — PDF, Word, photos of a printout, or straight from Canvas — and turns the whole
school year into a paced, load-balanced plan.

## What it does

- **Reads any syllabus.** PDF, DOCX, phone photos (multi-page), pasted text, or the Canvas syllabus page. Claude
  extracts course info, grading weights, the grade scale, every deadline (resolving "Week 5, Tuesday"), readings with
  chapters and page ranges, holidays and breaks, and pop-quiz policies, then flags anything it couldn't pin down.
  You review and edit everything before it's saved, and you can enter or fix any of it by hand.
- **Canvas import.** Connect Canvas to pull courses, assignments with due and lock dates, assignment-group weights, and
  your scores — and cross-check them against the syllabus ("Canvas locks Thu 11:59 PM, syllabus says Fri").
  Blackboard, Moodle, and other LMSs connect through their calendar feeds for the same discrepancy checks.
- **One calendar for the whole year.** Every course merged into a master calendar, with breaks deduplicated across
  syllabi and conflicts flagged (two exams the same day, a deadline on a holiday).
- **Red-zone weeks.** A weekly stress score (calm → busy → heavy → red) and alerts when three major deadlines land
  within 48 hours.
- **Paced reading.** "Read Chapters 4–7 by Tuesday" becomes bite-sized daily page targets using your textbook's
  chapter map (snap a photo of the table of contents) and your reading speed.
- **Buffer schedules.** Major papers and projects get early start dates and milestone check-ins (a full-draft check-in
  two weeks out for big ones); exams get study ramps; everything fits inside your daily study time.
- **Missed something?** Mark it missed and the remaining work is spread over the days you have left — no pile-ups.
- **Focus mode.** A Pomodoro timer tied to today's plan ("Study 25 mins for PSY 101 Quiz 1") and a calm morning
  notification with just your top 3 actions.
- **Grades.** Enter scores (or pull them from Canvas), see where you stand, ask "What do I need on the final?", and play
  out scenarios.
- **Sync everywhere.** Apple Calendar / Reminders on device, two-way Google Calendar / Tasks and Outlook / To Do, or a
  subscribable iCal feed. Deadlines go in as all-day events or tasks.
- **Study groups.** Share a course's parsed timeline as a link; classmates import it without re-uploading (grades are
  never shared).

Neo-brutalist design with light and dark mode.

## Stack

Expo SDK 58 · React Native 0.88 · Expo Router · TypeScript · TanStack Query · Supabase (Postgres + RLS, Auth with
Sign in with Apple, Storage, Realtime, Deno Edge Functions) · Claude Opus 5.5 for document parsing · Vitest.

## Docs

- [Setup, run, and ship](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Scheduling engine rules](docs/ENGINE.md)
- [Design system](docs/DESIGN.md)
