import { describe, expect, it } from 'vitest';

import type { ExtractedItem, ExtractedTextbook, SyllabusExtraction } from '@shared/extraction.ts';

import { courseColors } from '@/theme/tokens';
import type { Course, GradingComponent, Item, Term, TermEvent, Textbook } from '@/types/db';

import {
  chapterMapPages,
  deriveTermName,
  formatChapterList,
  formatPageRanges,
  parseChapterList,
  parsePageRanges,
  planImport,
  planTocImport,
  suggestTermChoice,
  totalWeight,
  type ImportContext,
  type MergeTarget,
} from './import-extraction';

const STAMP = '2026-08-01T00:00:00Z';

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    title: 'Quiz 1',
    kind: 'quiz',
    due_date: '2026-09-10',
    due_time: null,
    date_text: null,
    assigned_date: null,
    component_name: 'Quizzes',
    weight_percent: null,
    points_possible: 10,
    is_major: false,
    estimated_minutes: null,
    reading: null,
    description: null,
    source_quote: 'Quiz 1 on Sept 10',
    confidence: 0.9,
    ...overrides,
  };
}

function extraction(overrides: Partial<SyllabusExtraction> = {}): SyllabusExtraction {
  return {
    course: {
      title: 'Introduction to Psychology',
      code: 'PSY 101',
      section: '02',
      instructor: 'Dr. Rivera',
      instructor_email: 'rivera@example.edu',
      term_name: 'Fall 2026',
      start_date: '2026-08-24',
      end_date: '2026-12-11',
      meeting_days: [3, 1, 1],
      meeting_start: '10:00',
      meeting_end: '11:15',
      location: 'Hall 101',
      credits: 3,
    },
    grading_components: [
      { name: 'Quizzes', weight_percent: 20, expected_count: 5, drop_lowest: 1, notes: null, confidence: 0.9 },
      { name: 'Midterm Exam', weight_percent: 30, expected_count: 1, drop_lowest: 0, notes: null, confidence: 0.9 },
      { name: 'Papers', weight_percent: 30, expected_count: 2, drop_lowest: 0, notes: null, confidence: 0.9 },
      { name: 'Participation', weight_percent: 20, expected_count: null, drop_lowest: 0, notes: null, confidence: 0.8 },
    ],
    grade_scale: [
      { letter: 'B', min_percent: 80 },
      { letter: 'A', min_percent: 90 },
      { letter: ' ', min_percent: 10 },
    ],
    items: [
      item(),
      item({ title: 'Midterm', kind: 'exam', component_name: 'Midterm Exam', weight_percent: 30, is_major: true, due_date: '2026-10-14' }),
      item({ title: 'Paper 1', kind: 'paper', component_name: 'Papers', weight_percent: 10, due_date: '2026-10-01' }),
      item({ title: 'Paper 2', kind: 'paper', component_name: 'Papers', weight_percent: 20, due_date: '2026-11-20' }),
      item({ title: 'Quiz 2', component_name: null, due_date: null, date_text: 'Week 6, Thursday' }),
      item({
        title: 'Read Ch. 4-5',
        kind: 'reading',
        component_name: null,
        reading: {
          textbook_title: 'Psychology',
          chapters: ['4', '5'],
          page_ranges: [{ start: 0, end: 3 }],
          explicit_pages: null,
          description: null,
        },
      }),
      item({ title: '   ' }),
    ],
    term_events: [
      { title: 'Thanksgiving Break', kind: 'break', start_date: '2026-11-25', end_date: '2026-11-27' },
      { title: 'Thanksgiving break', kind: 'break', start_date: '2026-11-25', end_date: '2026-11-27' },
      { title: 'Reading Day', kind: 'no_class', start_date: '2026-12-02', end_date: '2026-12-01' },
    ],
    textbooks: [
      {
        title: 'Psychology',
        authors: 'Myers',
        edition: '13th ed.',
        chapters: [
          { number: '4', title: 'Memory', start_page: 101, end_page: 134 },
          { number: ' ', title: null, start_page: null, end_page: null },
        ],
      },
    ],
    policies: {
      late_policy: 'Minus 10% per day',
      unannounced_quizzes: true,
      attendance_policy: '  ',
      drop_policy: null,
      extra_credit: null,
    },
    warnings: [],
    ...overrides,
  };
}

function term(overrides: Partial<Term> = {}): Term {
  return {
    id: 'term-a',
    user_id: 'u',
    name: 'Fall 2026',
    start_date: '2026-08-20',
    end_date: '2026-12-20',
    is_active: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    user_id: 'u',
    term_id: null,
    code: null,
    title: 'Psych',
    section: null,
    instructor: 'Prof. Kept',
    instructor_email: null,
    color: '#123456',
    credits: null,
    meeting_days: [],
    meeting_start: null,
    meeting_end: null,
    location: null,
    start_date: null,
    end_date: null,
    target_percent: null,
    grade_scale: [
      { letter: 'A', min: 93 },
      { letter: 'A-', min: 90 },
      { letter: 'B+', min: 87 },
      { letter: 'B', min: 83 },
      { letter: 'B-', min: 80 },
      { letter: 'C+', min: 77 },
      { letter: 'C', min: 73 },
      { letter: 'C-', min: 70 },
      { letter: 'D+', min: 67 },
      { letter: 'D', min: 63 },
      { letter: 'D-', min: 60 },
      { letter: 'F', min: 0 },
    ],
    policies: { late_policy: 'Student wrote this', unannounced_quizzes: false },
    canvas_course_id: '42',
    shared_from_slug: null,
    archived: false,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function component(overrides: Partial<GradingComponent> = {}): GradingComponent {
  return {
    id: 'comp-x',
    user_id: 'u',
    course_id: 'course-1',
    name: 'Quiz',
    weight: 25,
    expected_count: null,
    drop_lowest: 0,
    source: 'canvas',
    canvas_group_id: 'g1',
    sort_order: 3,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-x',
    user_id: 'u',
    course_id: 'course-1',
    component_id: null,
    title: 'Quiz #1',
    kind: 'quiz',
    description: null,
    assigned_date: null,
    due_date: '2026-09-11',
    due_time: '23:59',
    weight_override: null,
    points_possible: null,
    score: 9,
    estimated_minutes: null,
    reading: null,
    pages: null,
    status: 'done',
    high_impact_override: null,
    is_major: false,
    source: 'canvas',
    confidence: null,
    source_quote: null,
    notes: null,
    canvas_assignment_id: 'a1',
    lms_due_at: null,
    lms_lock_at: null,
    lms_unlock_at: null,
    external_change: null,
    completed_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function textbook(overrides: Partial<Textbook> = {}): Textbook {
  return {
    id: 'book-x',
    user_id: 'u',
    course_id: 'course-1',
    title: 'Psychology',
    authors: null,
    chapters: [{ number: '4', title: null, start_page: 100, end_page: null }],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function termEvent(overrides: Partial<TermEvent> = {}): TermEvent {
  return {
    id: 'ev-x',
    user_id: 'u',
    term_id: null,
    course_id: 'course-1',
    title: 'Thanksgiving break!',
    kind: 'break',
    start_date: '2026-11-25',
    end_date: '2026-11-27',
    source: 'manual',
    created_at: STAMP,
    ...overrides,
  };
}

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return { terms: [], courseCount: 2, target: null, termChoice: { kind: 'none' }, newId: ids(), ...overrides };
}

describe('term helpers', () => {
  it('derives a season name from the start date', () => {
    expect(deriveTermName('2026-08-24')).toBe('Fall 2026');
    expect(deriveTermName('2027-01-12')).toBe('Spring 2027');
    expect(deriveTermName('2027-06-02')).toBe('Summer 2027');
    expect(deriveTermName(null)).toBeNull();
    expect(deriveTermName('soon')).toBeNull();
  });

  it('prefers an existing term with the same name', () => {
    const terms = [term({ id: 't1', name: 'Spring 2026' }), term({ id: 't2', name: 'fall  2026' })];
    expect(suggestTermChoice(extraction(), terms)).toEqual({ kind: 'existing', termId: 't2' });
  });

  it('falls back to a term whose dates contain the course start', () => {
    const draft = extraction();
    draft.course.term_name = 'Autumn Semester';
    expect(suggestTermChoice(draft, [term({ id: 't9', name: 'My fall' })])).toEqual({ kind: 'existing', termId: 't9' });
  });

  it('proposes a new term named from the syllabus or its dates', () => {
    const draft = extraction();
    expect(suggestTermChoice(draft, [])).toEqual({
      kind: 'new',
      name: 'Fall 2026',
      start_date: '2026-08-24',
      end_date: '2026-12-11',
    });
    draft.course.term_name = null;
    draft.course.start_date = '2027-01-15';
    expect(suggestTermChoice(draft, [])).toMatchObject({ kind: 'new', name: 'Spring 2027' });
  });

  it('uses the active term when the syllabus gives no hints, else none', () => {
    const draft = extraction();
    draft.course.term_name = null;
    draft.course.start_date = null;
    expect(suggestTermChoice(draft, [term({ id: 'old', is_active: false, name: 'X' }), term({ id: 'act', name: 'Y', start_date: null, end_date: null })])).toEqual({
      kind: 'existing',
      termId: 'act',
    });
    expect(suggestTermChoice(draft, [])).toEqual({ kind: 'none' });
  });
});

describe('text helpers', () => {
  it('parses and formats chapter lists', () => {
    expect(parseChapterList('Ch. 4-7, 9; Appendix B, 9')).toEqual(['4', '5', '6', '7', '9', 'Appendix B']);
    expect(parseChapterList('1-200')).toEqual(['1-200']);
    expect(parseChapterList('  ,  ')).toEqual([]);
    expect(formatChapterList(['4', '5', '6', '9', '10', 'Appendix B'])).toBe('4–6, 9, 10, Appendix B');
  });

  it('parses and formats page ranges', () => {
    expect(parsePageRanges('pp. 101-126, 130, 140 to 150, 0, 9-3, abc')).toEqual([
      { start: 101, end: 126 },
      { start: 130, end: 130 },
      { start: 140, end: 150 },
    ]);
    expect(formatPageRanges([{ start: 1, end: 1 }, { start: 5, end: 9 }])).toBe('1, 5–9');
  });

  it('totals weights and chapter pages', () => {
    expect(totalWeight([{ weight_percent: 33.33 }, { weight_percent: 33.33 }, { weight_percent: null }])).toBe(66.7);
    expect(
      chapterMapPages([
        { start_page: 1, end_page: 10 },
        { start_page: 11, end_page: null },
        { start_page: 30, end_page: 20 },
      ]),
    ).toBe(10);
  });
});

describe('planImport — new course', () => {
  it('creates the course, term, components, textbooks, items and events with linked ids', () => {
    const plan = planImport(
      extraction(),
      context({ termChoice: { kind: 'new', name: ' Fall 2026 ', start_date: '2026-12-20', end_date: '2026-08-20' } }),
    );

    expect(plan.newTerm).toEqual({ id: 'id-1', name: 'Fall 2026', start_date: '2026-08-20', end_date: '2026-12-20', is_active: true });
    expect(plan.termId).toBe('id-1');
    expect(plan.courseId).toBe('id-2');
    expect(plan.courseChanges).toBeNull();
    expect(plan.newCourse).toMatchObject({
      id: 'id-2',
      term_id: 'id-1',
      title: 'Introduction to Psychology',
      code: 'PSY 101',
      color: courseColors[2],
      meeting_days: [1, 3],
      grade_scale: [
        { letter: 'A', min: 90 },
        { letter: 'B', min: 80 },
      ],
      policies: {
        late_policy: 'Minus 10% per day',
        unannounced_quizzes: true,
        attendance_policy: null,
        drop_policy: null,
        extra_credit: null,
      },
    });

    expect(plan.components.create.map((c) => [c.name, c.weight, c.sort_order, c.course_id])).toEqual([
      ['Quizzes', 20, 0, 'id-2'],
      ['Midterm Exam', 30, 1, 'id-2'],
      ['Papers', 30, 2, 'id-2'],
      ['Participation', 20, 3, 'id-2'],
    ]);
    const componentId = (name: string) => plan.components.create.find((c) => c.name === name)?.id;

    expect(plan.textbooks.create).toEqual([
      {
        id: expect.any(String),
        course_id: 'id-2',
        title: 'Psychology (13th ed.)',
        authors: 'Myers',
        chapters: [{ number: '4', title: 'Memory', start_page: 101, end_page: 134 }],
      },
    ]);
    const bookId = plan.textbooks.create[0].id;

    const byTitle = (title: string) => plan.items.create.find((i) => i.title === title);
    expect(plan.items.create).toHaveLength(6);
    expect(byTitle('Quiz 1')).toMatchObject({ component_id: componentId('Quizzes'), source: 'ai', status: 'todo', notes: null });
    // Single-item component: the engine derives 30%, so no override.
    expect(byTitle('Midterm')).toMatchObject({ component_id: componentId('Midterm Exam'), weight_override: null, is_major: true });
    // Uneven papers keep their stated weights.
    expect(byTitle('Paper 1')?.weight_override).toBe(10);
    expect(byTitle('Paper 2')?.weight_override).toBe(20);
    // No component_name: the only quiz-like component still claims it; TBD wording is kept.
    expect(byTitle('Quiz 2')).toMatchObject({ component_id: componentId('Quizzes'), due_date: null, notes: 'Syllabus date: Week 6, Thursday' });
    expect(byTitle('Read Ch. 4-5')?.reading).toEqual({
      textbook_id: bookId,
      chapters: ['4', '5'],
      page_ranges: [],
      explicit_pages: null,
      description: null,
    });

    expect(plan.termEvents.create.map((e) => [e.title, e.start_date, e.end_date, e.course_id, e.term_id])).toEqual([
      ['Thanksgiving Break', '2026-11-25', '2026-11-27', 'id-2', 'id-1'],
      ['Reading Day', '2026-12-01', '2026-12-02', 'id-2', 'id-1'],
    ]);
    expect(plan.summary).toEqual({ itemsCreated: 6, itemsMerged: 0, componentsCreated: 4, textbooksCreated: 1, termEventsCreated: 2 });
  });

  it('keeps the stated weight for items without a component', () => {
    const draft = extraction({
      grading_components: [],
      items: [item({ title: 'Final Project', kind: 'project', component_name: 'Projects', weight_percent: 140 })],
    });
    const plan = planImport(draft, context());
    expect(plan.items.create[0]).toMatchObject({ component_id: null, weight_override: 100 });
  });

  it('uses an existing term only when it really exists', () => {
    const terms = [term({ id: 'real' })];
    expect(planImport(extraction(), context({ terms, termChoice: { kind: 'existing', termId: 'real' } })).termId).toBe('real');
    const ghost = planImport(extraction(), context({ terms, termChoice: { kind: 'existing', termId: 'ghost' } }));
    expect(ghost.termId).toBeNull();
    expect(ghost.newCourse?.term_id).toBeNull();
    expect(ghost.newTerm).toBeNull();
  });

  it('falls back to the code as the title and omits an empty grade scale', () => {
    const draft = extraction({ grade_scale: [] });
    draft.course.title = '  ';
    const plan = planImport(draft, context());
    expect(plan.newCourse?.title).toBe('PSY 101');
    expect(plan.newCourse && 'grade_scale' in plan.newCourse).toBe(false);
  });
});

describe('planImport — merging into an existing course', () => {
  function target(overrides: Partial<MergeTarget> = {}): MergeTarget {
    return {
      course: course(),
      components: [component({ id: 'comp-q', name: 'Quiz', weight: 25 })],
      items: [dbItem({ id: 'item-q1', title: 'Quiz #1', due_date: '2026-09-11', due_time: '23:59' })],
      textbooks: [textbook()],
      termEvents: [termEvent()],
      ...overrides,
    };
  }

  it('fills empty course fields and never overwrites the student', () => {
    const plan = planImport(extraction(), context({ target: target(), termChoice: { kind: 'existing', termId: 'term-a' }, terms: [term()] }));
    expect(plan.newCourse).toBeNull();
    expect(plan.courseId).toBe('course-1');
    expect(plan.courseChanges).toMatchObject({
      code: 'PSY 101',
      section: '02',
      instructor_email: 'rivera@example.edu',
      credits: 3,
      start_date: '2026-08-24',
      meeting_days: [1, 3],
      term_id: 'term-a',
      grade_scale: [
        { letter: 'A', min: 90 },
        { letter: 'B', min: 80 },
      ],
    });
    // The student's late policy and explicit "no pop quizzes" stay; nothing else to fill.
    expect(plan.courseChanges).not.toHaveProperty('policies');
    expect(plan.courseChanges).not.toHaveProperty('instructor');
    expect(plan.courseChanges).not.toHaveProperty('title');
  });

  it('fills missing policy fields and an unset pop-quiz flag', () => {
    const open = target({ course: course({ policies: {} }) });
    const plan = planImport(extraction(), context({ target: open }));
    expect(plan.courseChanges?.policies).toEqual({ late_policy: 'Minus 10% per day', unannounced_quizzes: true });
  });

  it('keeps a customised grade scale and the course term', () => {
    const custom = target({ course: course({ term_id: 'mine', grade_scale: [{ letter: 'P', min: 50 }] }) });
    const plan = planImport(extraction(), context({ target: custom, termChoice: { kind: 'new', name: 'Fall 2026', start_date: null, end_date: null } }));
    expect(plan.termId).toBe('mine');
    expect(plan.newTerm).toBeNull();
    expect(plan.courseChanges).not.toHaveProperty('grade_scale');
    expect(plan.courseChanges).not.toHaveProperty('term_id');
  });

  it('matches components and items, filling only gaps', () => {
    const plan = planImport(extraction(), context({ target: target() }));
    // "Quizzes" matches the Canvas "Quiz" group; the other three are new and sorted after it.
    expect(plan.components.update).toEqual([{ id: 'comp-q', changes: { expected_count: 5 } }]);
    expect(plan.components.create.map((c) => [c.name, c.sort_order])).toEqual([
      ['Midterm Exam', 4],
      ['Papers', 5],
      ['Participation', 6],
    ]);

    // Quiz 1 ≈ "Quiz #1" (one day apart): merged, its Canvas date/time and score untouched.
    expect(plan.summary.itemsMerged).toBe(1);
    expect(plan.items.update).toEqual([
      { id: 'item-q1', changes: { component_id: 'comp-q', points_possible: 10, source_quote: 'Quiz 1 on Sept 10' } },
    ]);
    expect(plan.items.create.map((i) => i.title)).not.toContain('Quiz 1');
    expect(plan.items.create.find((i) => i.title === 'Quiz 2')?.component_id).toBe('comp-q');
  });

  it('fills an existing textbook map and skips duplicate term events', () => {
    const plan = planImport(extraction(), context({ target: target() }));
    expect(plan.textbooks.create).toHaveLength(0);
    expect(plan.textbooks.update).toEqual([
      { id: 'book-x', changes: { authors: 'Myers', chapters: [{ number: '4', title: 'Memory', start_page: 100, end_page: 134 }] } },
    ]);
    expect(plan.items.create.find((i) => i.title === 'Read Ch. 4-5')?.reading?.textbook_id).toBe('book-x');
    expect(plan.termEvents.create.map((e) => e.title)).toEqual(['Reading Day']);
  });

  it('does not invent changes when nothing is missing', () => {
    const full = target({
      course: course({
        code: 'PSY 101',
        section: '02',
        instructor_email: 'x@y.edu',
        location: 'Room',
        credits: 4,
        start_date: '2026-08-20',
        end_date: '2026-12-01',
        meeting_start: '09:00',
        meeting_end: '10:00',
        meeting_days: [2],
        term_id: 'term-a',
        grade_scale: [{ letter: 'A', min: 95 }],
        policies: {
          late_policy: 'a',
          attendance_policy: 'b',
          drop_policy: 'c',
          extra_credit: 'd',
          unannounced_quizzes: false,
        },
      }),
    });
    const plan = planImport(extraction(), context({ target: full }));
    expect(plan.courseChanges).toBeNull();
  });
});

describe('planTocImport', () => {
  const book: ExtractedTextbook = {
    title: 'Biology',
    authors: 'Campbell',
    edition: null,
    chapters: [
      { number: '1', title: 'Life', start_page: 1, end_page: 20 },
      { number: '2', title: 'Chemistry', start_page: 21, end_page: 44 },
    ],
  };

  it('creates a new textbook on the chosen course', () => {
    const plan = planTocImport(book, { courseId: 'c1', existing: null }, ids('tb'));
    expect(plan.update).toBeNull();
    expect(plan.textbookId).toBe('tb-1');
    expect(plan.create).toMatchObject({ id: 'tb-1', course_id: 'c1', title: 'Biology', authors: 'Campbell' });
    expect(plan.create?.chapters).toHaveLength(2);
  });

  it('replaces the chapter map of an existing book and fills only empty details', () => {
    const plan = planTocImport(book, { courseId: 'c1', existing: textbook({ authors: 'Kept' }) }, ids());
    expect(plan.create).toBeNull();
    expect(plan.textbookId).toBe('book-x');
    expect(plan.update?.changes).toEqual({ chapters: plan.update?.changes.chapters });
    expect(plan.update?.changes.chapters).toHaveLength(2);
  });
});
