import { describe, expect, it } from 'vitest';
import type { TocExtraction } from './extraction.ts';
import {
  buildUserPrompt,
  detectSection,
  localDateISO,
  normalizeTocExtraction,
  progressNoteFor,
  SYLLABUS_SYSTEM_PROMPT,
  systemPromptFor,
  TOC_SYSTEM_PROMPT,
} from './prompts.ts';

describe('system prompts', () => {
  it('are stable strings with no per-request content', () => {
    expect(systemPromptFor('syllabus')).toBe(SYLLABUS_SYSTEM_PROMPT);
    expect(systemPromptFor('toc')).toBe(TOC_SYSTEM_PROMPT);
    expect(SYLLABUS_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // Long enough to clear the prompt-cache minimum (well over 512 tokens).
    expect(SYLLABUS_SYSTEM_PROMPT.length).toBeGreaterThan(4000);
  });

  it('cover the extraction rules the planner relies on', () => {
    for (const rule of ['Week 5 Tuesday', 'Ch. 4–7', 'is_major', 'component_name', 'unannounced', 'term_events', 'grade_scale', 'source_quote', 'Never invent a date']) {
      expect(SYLLABUS_SYSTEM_PROMPT).toContain(rule);
    }
    expect(TOC_SYSTEM_PROMPT).toContain('next start_page − 1');
    for (const prompt of [SYLLABUS_SYSTEM_PROMPT, TOC_SYSTEM_PROMPT]) expect(prompt).toContain('empty string ""');
  });
});

describe('buildUserPrompt', () => {
  it('includes today, the time zone, the linked course, and the documents', () => {
    const text = buildUserPrompt({
      kind: 'syllabus',
      source: 'upload',
      today: '2026-10-27',
      timezone: 'America/Chicago',
      course: {
        title: 'Intro to Psychology',
        code: 'PSY 101',
        start_date: '2026-08-24',
        end_date: '2026-12-11',
        meeting_days: [3, 1, 5, 1],
        meeting_start: '10:00:00',
        meeting_end: '10:50:00',
        term: { name: 'Fall 2026', start_date: '2026-08-24', end_date: '2026-12-18' },
      },
      documents: [
        { name: 'page1.jpg', kind: 'image' },
        { name: 'page2.jpg', kind: 'image' },
      ],
    });
    expect(text).toContain('Today is 2026-10-27 in the student\'s time zone (America/Chicago).');
    expect(text).toContain('"PSY 101 — Intro to Psychology", runs 2026-08-24 to 2026-12-11, meets Mon/Wed/Fri 10:00–10:50, term "Fall 2026" (2026-08-24 to 2026-12-18)');
    expect(text).toContain('1. page1.jpg (photo)');
    expect(text).toContain('The 2 photos are consecutive pages of one syllabus, in order.');
    expect(text.trim().endsWith('Extract the syllabus.')).toBe(true);
  });

  it('describes TOC uploads and omits the course when there is none', () => {
    const text = buildUserPrompt({
      kind: 'toc',
      source: 'upload',
      today: '2026-01-05',
      timezone: 'UTC',
      course: null,
      documents: [{ name: 'toc.jpg', kind: 'image' }],
    });
    expect(text).not.toContain('linked');
    expect(text).toContain('Extract the chapter page map');
  });
});

describe('localDateISO', () => {
  it('uses the student time zone, not UTC', () => {
    const instant = new Date('2026-10-27T03:30:00Z');
    expect(localDateISO('America/Los_Angeles', instant)).toBe('2026-10-26');
    expect(localDateISO('Asia/Tokyo', instant)).toBe('2026-10-27');
  });

  it('falls back to UTC for an invalid zone', () => {
    expect(localDateISO('Not/AZone', new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-27');
  });
});

describe('progress notes', () => {
  it('detects the section being written in streamed JSON', () => {
    expect(detectSection('syllabus', '{"course": {"title": "Bio"}, "grading_components" : [')).toBe('grading_components');
    expect(detectSection('syllabus', '"textbook_title": "x"')).toBeNull();
    expect(detectSection('toc', '{"textbook": {"title": "B", "chapters": [')).toBe('chapters');
  });

  it('chooses notes by section, then by elapsed time', () => {
    expect(progressNoteFor('syllabus', { elapsedMs: 1000, section: null })).toBe('Reading your syllabus…');
    expect(progressNoteFor('syllabus', { elapsedMs: 20_000, section: null })).toBe('Working out the course calendar…');
    expect(progressNoteFor('syllabus', { elapsedMs: 5000, section: 'items' })).toBe('Finding deadlines…');
    expect(progressNoteFor('syllabus', { elapsedMs: 5000, section: 'grade_scale' })).toBe('Checking grading weights…');
    expect(progressNoteFor('toc', { elapsedMs: 5000, section: 'chapters' })).toBe('Mapping chapter pages…');
    expect(progressNoteFor('toc', { elapsedMs: 5000, section: null })).toBe('Reading the table of contents…');
  });
});

describe('normalizeTocExtraction', () => {
  it('fills end pages from the next chapter and drops impossible ranges', () => {
    const toc: TocExtraction = {
      textbook: {
        title: 'Biology',
        authors: null,
        edition: null,
        chapters: [
          { number: '1', title: 'Cells', start_page: 1, end_page: null },
          { number: '2', title: 'Genes', start_page: 31, end_page: 29 },
          { number: '3', title: 'Evolution', start_page: 60, end_page: 88 },
          { number: '4', title: 'Ecology', start_page: 89, end_page: null },
        ],
      },
      warnings: [],
    };
    const out = normalizeTocExtraction(toc).textbook.chapters;
    expect(out.map((c) => [c.start_page, c.end_page])).toEqual([
      [1, 30],
      [31, null],
      [60, 88],
      [89, null],
    ]);
  });
});
