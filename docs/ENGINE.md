# Scheduling & grading engine — behaviour spec

`src/engine` is pure TypeScript: no React Native, no Supabase, no clock reads (`settings.today`
is passed in), no randomness, no imports from outside `src/engine`. Same input ⇒ same output.
Public signatures are fixed by `src/engine/index.ts` + `src/engine/types.ts`.

## Vocabulary

- **Item** — something on a syllabus: exam, quiz, paper, project, homework, reading, presentation, lab, discussion, other.
- **Major** — kind ∈ {exam, paper, project, presentation} or `is_major = true`.
- **Effective weight** — % of the course grade (see `effectiveWeight`).
- **High impact** — `high_impact_override` if non-null; else weight ≥ `high_impact_threshold` (default 15);
  else an exam/paper/project with weight ≥ threshold/2; else `is_major` with unknown weight.
- **Block** — one chunk of planned work on one day (`EngineBlock`). Kinds: reading, work, milestone, study, review.
- **Study day** — a date whose weekday is in `study_days` and that is not in `blackout_dates`.

## Effective weight

1. `weight_override` when set.
2. Else component weight ÷ N, where N = max(`expected_count` ?? 0, number of items linked to the component),
   reduced by `drop_lowest` when that keeps N ≥ 1. N = 0 ⇒ null.
3. Else null.

## Impact score (0–100)

Blend, documented in code: grade weight (dominant; 25% of grade ≈ 60 points), kind bonus (exam/paper/project +15,
presentation/quiz +5), credits multiplier (credits/3, clamp 0.67–1.5). `reasons` explains it in plain words,
e.g. `"Worth 25% of PSY 101"`, `"Final exam"`, `"Marked high impact"`.

## Effort

- Reading pages (`resolveReadingPages`): `pages` → `reading.explicit_pages` → Σ page_ranges (end − start + 1) →
  chapters via the textbook chapter map (end_page − start_page + 1; chapter missing from the map falls back to the
  default) → chapters × `default_pages_per_chapter`. Not a reading and no reading ref ⇒ null.
- Minutes (`estimateEffortMinutes`): readings = ceil(pages ÷ pages_per_hour × 60) (min 10);
  others = `estimated_minutes` if set, else `DEFAULT_EFFORT_MINUTES[kind]` scaled by weight
  (×0.6 under 5%, ×1 at 10–20%, ×1.5 at ≥ 30%), rounded to 5 minutes.

## buildPlan

Output contract is `PlanResult` (see `types.ts`). Steps:

1. **Lock history.** Existing blocks with status done/missed/skipped, or `generated_by: 'manual'`, are kept as-is.
   Existing engine `planned` blocks dated **before today** are returned as `missed` (carry-over). Existing engine
   `planned` blocks dated today or later are discarded and regenerated.
2. **Remaining work per item.** Skip items with status done/missed, items with no `due_date`, and items whose
   due date < today. Remaining minutes = effort − Σ minutes of that item's `done` blocks. Readings track pages:
   remaining pages = resolved pages − pages covered by done reading blocks; new reading blocks continue from the
   next unread page (page_start/page_end are absolute page numbers when a page range or chapter map is known,
   else 1-based relative pages).
3. **Windows (latest allowed day = due − 1; the due date itself only gets work when nothing else fits, and never for papers/projects).**
   - reading: start = max(today, assigned_date ?? due − 7); end = due − 1 (read before class).
   - homework/lab/discussion/other: start = max(today, due − 3).
   - quiz: study ramp over the 2 study days before due.
   - exam: study ramp starts at due − 7 when high impact, else due − 4; sessions grow toward the exam
     (e.g. 15%, 20%, 30%, 35% of effort on the last four study days), plus a final `review` block on due − 1.
   - paper/project/presentation (**buffer generator**): lead = 21 days if weight ≥ 20 or high impact,
     14 days if weight ≥ 10, else 7. Start = max(today, assigned_date, due − lead). Milestone blocks
     (kind `milestone`, 15–30 min, sorted first on their day):
       - "Start: pick topic & gather sources" on the start day
       - "Milestone check-in: outline" ~40% into the window
       - "Milestone check-in: full draft" at due − 14 for high-impact work (else ~70% into the window)
       - "Final review & polish" at due − 2 (presentations: "Rehearse out loud")
     Work blocks fill the window and must finish by due − 2 when the window allows (the early-start buffer);
     due − 1 is reserved for the final review.
   - Courses with `policies.unannounced_quizzes`: a 10-minute `review` block ("Review notes — pop quiz risk")
     on each class meeting day (course.meeting_days) within the next 14 days that has no other block for that course.
   - Windows shorter than one study day collapse to the latest study day ≤ due − 1, or today.
4. **Load-balance.** Process items by (due date asc, impact score desc, id). Spread each item's remaining minutes
   over the study days of its window by water-filling: always add the next chunk to the window day with the lowest
   current load, chunks of 15–60 minutes (readings: chunks of whole pages, ≥ 5 pages unless fewer remain), never
   exceeding `daily_capacity_minutes` on a day. Ties go to the earlier day (finish early, not late).
5. **Overflow.** If capacity is exhausted in the window, allow up to 125% of capacity on the least-loaded days;
   anything still unplaced becomes an `OverflowWarning` with a plain suggestion ("Start the HIST 210 paper by
   Oct 30 or drop 2 low-impact readings this week"). Never dump the remainder onto one day.
6. **Keys & labels.** Block keys are deterministic: `${item_id}:${kind}:${n}` with n continuing past the highest
   n already used for that item, so keys never collide with history. Labels are concrete: "Read pp. 101–126 (Ch. 4)",
   "Work on Research Paper (45 min)", "Study for Midterm 1", "Milestone check-in: full draft".
7. **days** covers today … the latest due date (max 180 days) via `computeDayLoads`.

## rescheduleAfterMiss

Mark the block missed (it stays in history), then rebuild with the same rules. Its minutes/pages return to the
item's remaining pool and are spread over the study days left before the deadline. `summary` reads like
"Moved 40 pages of PSY 101 reading across Wed–Fri" or, when no room is left, the overflow suggestion. `moved` lists
the new planned blocks for that item.

## Red zones

Consider incomplete items with a due date ≥ `from` (default today). Slide a window of `windowDays` (default 2 =
48 hours: date d and d+1). **Red**: ≥ `minMajor` (default 3) major or high-impact deadlines in the window.
**Orange**: 2 major deadlines from different courses, or ≥ 4 deadlines of any kind. Merge overlapping windows
of the same or lower severity into one zone (red wins). `message`: "3 major deadlines in 48 hours across PSY 101,
HIST 210".

## Weekly stress score

For each Monday-based week: score = round(min(100,
  35 × min(1, plannedMinutes ÷ capacityMinutes)
  + min(40, 4 × deadlinePoints)
  + (red zone in week ? 25 : orange ? 12 : 0))),
where deadlinePoints = Σ over items due that week of (high impact 3, major 2, other 1) and capacityMinutes =
study days × daily capacity. Levels: < 30 calm, < 55 busy, < 75 heavy, else red; any red zone forces `red`.
`drivers` names the top contributors ("Midterm 1 (PSY 101)", "Planned 14h vs 12h free").

## Triage (top 3)

Candidates: each incomplete item with a planned block on `date`, anything overdue (due < date, not done), anything
due within 2 days, and high-impact items inside a red zone starting within 7 days. Priority = impact score × 0.5
+ urgency (due today 50, tomorrow 40, 2 days 30, ≤ 7 days 15) + overdue 60 + has a block today 20. One action per
item, highest first, ties by due date then title. Each action names a concrete step and minutes (the day's block
label when one exists).

## Pomodoro

`focusLabel` ⇒ `"Study 25 mins for PSY 101 Quiz 1"` (course code, else title; minutes as given).
`focusQueue` orders the date's planned blocks by triage priority and caps each task at `focusMinutes`.
`pomodoroCycles(total, focus = 25, short = 5, long = 15, every = 4)`: focus segments until total focus minutes are
covered (last one may be shorter), breaks between, a long break after every 4th focus, no trailing break.

## Grades

- `itemPercent`: score ÷ points_possible × 100, or score when points_possible is null; null when score is null.
- Component percent: points-based (Σ score ÷ Σ points) when every graded item has points_possible, else mean of
  item percents. Drop the `drop_lowest` lowest graded items only while more than `drop_lowest` remain graded.
- Items with `weight_override` and no component behave as their own component of that weight.
- `courseGrade.percent` = Σ(weight × percent) ÷ Σ weight over components with ≥ 1 graded item.
  `projectedMin/Max` = final grade if every ungraded item scored 0 / 100 (null if no weights at all).
- `requiredScore` solves for the target item's percent (bisection over 0–200, which also handles drop-lowest)
  with other ungraded items at the current component average (`current_average`, falling back to the course
  average), 0 (`zero`), or 100 (`perfect`). `alreadySecured` when 0 still reaches the target; `achievable` false
  when > 100 is needed (still report the number). The explanation is one plain sentence.
- `simulateGrade` = `courseGrade` with hypothetical percents applied.

## Synthesis (whole school year)

- `mergeTermEvents`: same kind, overlapping or adjacent date ranges, and similar titles (case/punctuation-
  insensitive, or one contains the other) merge into one event spanning both ranges; course_id becomes null when
  merged across courses.
- `synthesizeMasterCalendar`: every dated item from every non-archived course + merged term events, sorted.
  Conflicts: `same_day_majors` (≥ 2 major items from different courses on one date), `due_on_holiday` (item due
  inside a holiday/break — usually a parsing mistake worth checking), `outside_course_dates`, `unscheduled` (items
  with no due date, one conflict listing them all).

## Tests

Vitest, `src/engine/__tests__/*.test.ts`. Cover every rule above with small hand-built fixtures, including:
capacity never exceeded unless overflowing, no block after the due date, papers finish by due − 2, the 2-week
check-in, carry-over of past planned blocks, missed-block redistribution with no day over capacity, red/orange
detection and merging, stress levels, triage ordering, drop-lowest, required-score edge cases, and term-event merging.
