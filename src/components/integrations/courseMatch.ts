// Suggests which existing Termwise course an LMS course is (e.g. one created from an uploaded
// syllabus), by course code first and title words second.
import type { Course } from '@/types/db';

export interface CourseMatch {
  course: Course;
  /** 0..1 */
  score: number;
}

const STOP_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'for', 'a', 'an', 'intro', 'introduction', 'section', 'sec']);

/** "PSY-101 (Fall 26)" -> "PSY101". Picks the first letters+digits code it finds. */
export function normalizeCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /([A-Za-z]{2,5})\s*[-_.]?\s*(\d{2,4}[A-Za-z]?)/.exec(text);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : null;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)),
  );
}

function titleSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(left.size, right.size);
}

/** Best confident match (score ≥ 0.5), or null. */
export function suggestCourse(
  lmsCourse: { name: string; course_code: string | null },
  courses: readonly Course[],
): CourseMatch | null {
  const lmsCode = normalizeCode(lmsCourse.course_code) ?? normalizeCode(lmsCourse.name);
  let best: CourseMatch | null = null;
  for (const course of courses) {
    const code = normalizeCode(course.code) ?? normalizeCode(course.title);
    let score = titleSimilarity(lmsCourse.name, course.title) * 0.8;
    if (lmsCode && code && lmsCode === code) score = Math.max(score, 0.9 + titleSimilarity(lmsCourse.name, course.title) * 0.1);
    if (!best || score > best.score) best = { course, score };
  }
  return best && best.score >= 0.5 ? best : null;
}
