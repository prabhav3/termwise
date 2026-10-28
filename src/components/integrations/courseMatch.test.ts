import { describe, expect, it } from 'vitest';

import type { Course } from '@/types/db';

import { normalizeCode, suggestCourse } from './courseMatch';

function course(id: string, title: string, code: string | null): Course {
  return {
    id,
    user_id: 'u',
    term_id: null,
    code,
    title,
    section: null,
    instructor: null,
    instructor_email: null,
    color: '#4D96FF',
    credits: null,
    meeting_days: [],
    meeting_start: null,
    meeting_end: null,
    location: null,
    start_date: null,
    end_date: null,
    target_percent: null,
    grade_scale: [],
    policies: {},
    canvas_course_id: null,
    shared_from_slug: null,
    archived: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  };
}

const courses = [
  course('psy', 'Introduction to Psychology', 'PSY 101'),
  course('bio', 'Cell Biology', 'BIO-210'),
  course('hist', 'Modern European History', null),
];

describe('normalizeCode', () => {
  it('pulls letters + digits out of messy LMS codes', () => {
    expect(normalizeCode('PSY-101 (Fall 26)')).toBe('PSY101');
    expect(normalizeCode('bio_210L')).toBe('BIO210L');
    expect(normalizeCode('Seminar')).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe('suggestCourse', () => {
  it('matches by course code first', () => {
    expect(suggestCourse({ name: 'PSY101 F26 Sec 2', course_code: 'PSY-101-002' }, courses)?.course.id).toBe('psy');
    expect(suggestCourse({ name: 'BIO 210: Cells', course_code: null }, courses)?.course.id).toBe('bio');
  });

  it('falls back to title words', () => {
    expect(suggestCourse({ name: 'Modern European History', course_code: 'HST-3' }, courses)?.course.id).toBe('hist');
  });

  it('returns null when nothing is close', () => {
    expect(suggestCourse({ name: 'Organic Chemistry', course_code: 'CHEM 220' }, courses)).toBeNull();
    expect(suggestCourse({ name: 'Anything', course_code: null }, [])).toBeNull();
  });
});
