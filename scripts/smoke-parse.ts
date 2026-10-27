// Live smoke test for the syllabus parser: sends a small built-in syllabus through the same
// system prompt, structured-output schema, and validation as the parse-syllabus function, then
// prints the normalized extraction. Calls the real Claude API and costs money — run it by hand:
//
//   ANTHROPIC_API_KEY=... npx deno run --allow-env --allow-net \
//     --config supabase/functions/parse-syllabus/deno.json scripts/smoke-parse.ts
//
// Optional env: PARSE_MODEL (default claude-opus-5-5), PARSE_EFFORT (default medium).
// Type-check only: npx deno check --config supabase/functions/parse-syllabus/deno.json scripts/smoke-parse.ts

import {
  createClaudeClient,
  DEFAULT_PARSE_MODEL,
  describeClaudeError,
  parseEffort,
  requestStructuredOutput,
  usageSummary,
} from '../supabase/functions/_shared/claude.ts';
import { normalizeExtraction, SyllabusExtraction } from '../supabase/functions/_shared/extraction.ts';
import { parseStructuredOutput, toClaudeOutputSchema } from '../supabase/functions/_shared/json-schema.ts';
import { buildUserPrompt, detectSection, localDateISO, progressNoteFor, SYLLABUS_SYSTEM_PROMPT } from '../supabase/functions/_shared/prompts.ts';

const SAMPLE_SYLLABUS = `PSY 101-02: Introduction to Psychology — Fall 2026
Instructor: Dr. Maya Lee (mlee@example.edu) · MWF 10:00–10:50 · Hall 204 · 3 credits
Classes begin Monday, August 24, 2026 and end Friday, December 11, 2026.

Textbook: Myers & DeWall, Psychology, 14th edition (required).

Grading
Quizzes (best 8 of 10) ........ 20%
Midterm Exam ................... 25%
Research Paper ................. 25%
Final Exam ..................... 25%
Participation ................... 5%
Pop quizzes may be given at any time and count toward participation.
Late work loses 10% per day; nothing is accepted after 3 days.

Grade scale: A 93, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73, D 60, F below 60.

Schedule
Week 1 (Aug 24): Ch. 1–2. Quiz 1 on Friday.
Week 2: Ch. 3, pp. 88–121. Quiz 2 on Friday.
Sep 7: Labor Day — no class.
Week 4 Wednesday: Research paper topic due.
Week 8 Wednesday: Midterm Exam (Ch. 1–7).
Oct 12–13: Fall break.
Nov 20: Research paper due by 11:59 pm (8–10 pages).
Nov 25–27: Thanksgiving break.
Final Exam: TBA during finals week (Dec 14–18).`;

async function main(): Promise<number> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY to run the smoke test.');
    return 2;
  }
  const model = Deno.env.get('PARSE_MODEL')?.trim() || DEFAULT_PARSE_MODEL;
  const effort = parseEffort(Deno.env.get('PARSE_EFFORT'));
  const output = toClaudeOutputSchema(SyllabusExtraction);
  const timezone = 'America/New_York';
  const prompt = buildUserPrompt({
    kind: 'syllabus',
    source: 'paste',
    today: localDateISO(timezone),
    timezone,
    course: null,
    documents: [{ name: 'Pasted syllabus text', kind: 'pasted' }],
  });

  const started = Date.now();
  let section: string | null = null;
  let lastNote = '';
  const report = () => {
    const note = progressNoteFor('syllabus', { elapsedMs: Date.now() - started, section });
    if (note !== lastNote) console.error(`… ${note}`);
    lastNote = note;
  };
  const timer = setInterval(report, 3000);
  report();

  try {
    const outcome = await requestStructuredOutput(createClaudeClient(apiKey), {
      model,
      effort,
      system: SYLLABUS_SYSTEM_PROMPT,
      content: [
        { type: 'document', source: { type: 'text', media_type: 'text/plain', data: SAMPLE_SYLLABUS }, title: 'Pasted syllabus text' },
        { type: 'text', text: prompt },
      ],
      schema: output.schema,
      onText: (delta, snapshot) => {
        section = detectSection('syllabus', snapshot.slice(-(delta.length + 40))) ?? section;
      },
    });
    if (outcome.status !== 'ok') {
      console.error(`Stopped without a usable result: ${outcome.status} (stop_reason ${outcome.message.stop_reason}).`);
      return 1;
    }
    const parsed = parseStructuredOutput(outcome.text, SyllabusExtraction, output);
    if (!parsed.ok) {
      console.error(`Output failed validation (${parsed.reason}): ${parsed.detail}`);
      return 1;
    }
    console.log(JSON.stringify(normalizeExtraction(parsed.data), null, 2));
    console.error(JSON.stringify(usageSummary(outcome.message, { requested_model: model, effort, files_api: false })));
    console.error(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    return 0;
  } catch (err) {
    const failure = describeClaudeError(err);
    console.error(`${failure.message} (${failure.log})`);
    return 1;
  } finally {
    clearInterval(timer);
  }
}

Deno.exit(await main());
