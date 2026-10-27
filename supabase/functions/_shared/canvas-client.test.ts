import { describe, expect, it } from 'vitest';
import {
  assignmentWeight,
  type CanvasAssignment,
  type CanvasAssignmentGroup,
  CanvasClient,
  CanvasError,
  type CanvasFetcher,
  computeGroupWeights,
  hasSyllabusContent,
  htmlToText,
  inferCanvasKind,
  isMajorAssignment,
  normalizeCanvasBaseUrl,
  parseLinkHeader,
  scoreFromSubmission,
  submissionIsComplete,
} from './canvas-client.ts';
import type { SafeResponse } from './safe-fetch.ts';

const assignment = (over: Partial<CanvasAssignment> & { id: string; name: string }): CanvasAssignment => ({
  description: null,
  due_at: null,
  lock_at: null,
  unlock_at: null,
  points_possible: 10,
  submission_types: ['online_upload'],
  published: true,
  assignment_group_id: 'g1',
  ...over,
});

describe('normalizeCanvasBaseUrl', () => {
  it('normalizes what students paste', () => {
    expect(normalizeCanvasBaseUrl('school.instructure.com')).toBe('https://school.instructure.com');
    expect(normalizeCanvasBaseUrl(' https://School.Instructure.com/courses/123?x=1 ')).toBe('https://school.instructure.com');
    expect(normalizeCanvasBaseUrl('http://canvas.university.edu/')).toBe('https://canvas.university.edu');
  });

  it('rejects private and malformed hosts', () => {
    expect(() => normalizeCanvasBaseUrl('localhost:3000')).toThrow();
    expect(() => normalizeCanvasBaseUrl('https://10.0.0.8')).toThrow();
    expect(() => normalizeCanvasBaseUrl('canvas')).toThrow();
    expect(() => normalizeCanvasBaseUrl('')).toThrow();
  });
});

describe('parseLinkHeader', () => {
  it('reads Canvas pagination links', () => {
    const header =
      '<https://s.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next",<https://s.instructure.com/api/v1/courses?page=1&per_page=100>; rel="first", <https://s.instructure.com/api/v1/courses?page=3&per_page=100>; rel="last"';
    expect(parseLinkHeader(header)).toEqual({
      next: 'https://s.instructure.com/api/v1/courses?page=2&per_page=100',
      first: 'https://s.instructure.com/api/v1/courses?page=1&per_page=100',
      last: 'https://s.instructure.com/api/v1/courses?page=3&per_page=100',
    });
    expect(parseLinkHeader(null)).toEqual({});
  });
});

describe('inferCanvasKind', () => {
  it('uses names first, then submission types', () => {
    const kind = (name: string, submission_types: string[] = ['online_upload'], is_quiz_assignment = false) =>
      inferCanvasKind({ name, submission_types, is_quiz_assignment });
    expect(kind('Midterm Exam', ['online_quiz'])).toBe('exam');
    expect(kind('Chapter 3 Check-in', ['online_quiz'])).toBe('quiz');
    expect(kind('Final Project')).toBe('project');
    expect(kind('Lab Report 2')).toBe('lab');
    expect(kind('Assignment: Final Paper')).toBe('paper');
    expect(kind('Problem Set 4')).toBe('homework');
    expect(kind('Week 3 post', ['discussion_topic'])).toBe('discussion');
    expect(kind('Reading Response 2')).toBe('reading');
    expect(kind('Participation', ['none'])).toBe('other');
    expect(kind('Pearson MyLab', ['external_tool'])).toBe('homework');
    expect(kind('Chapter 5 problems', ['external_tool'])).toBe('homework');
  });
});

describe('computeGroupWeights', () => {
  const groups: CanvasAssignmentGroup[] = [
    {
      id: 'g1',
      name: 'Quizzes',
      position: 1,
      group_weight: 20,
      rules: { drop_lowest: 1 },
      assignments: [1, 2, 3, 4, 5].map((n) => assignment({ id: `q${n}`, name: `Quiz ${n}`, points_possible: 10 })),
    },
    {
      id: 'g2',
      name: 'Exams',
      position: 2,
      group_weight: 80,
      assignments: [
        assignment({ id: 'e1', name: 'Midterm', points_possible: 100 }),
        assignment({ id: 'e2', name: 'Final', points_possible: 100 }),
        assignment({ id: 'x', name: 'Unpublished', points_possible: 500, published: false }),
        assignment({ id: 'y', name: 'Practice', points_possible: 500, omit_from_final_grade: true }),
      ],
    },
  ];

  it('uses group weights when the course applies them', () => {
    const w = computeGroupWeights(groups, true);
    expect(w.get('g1')).toEqual({ weight: 20, derived: false, count: 5, dropLowest: 1 });
    expect(w.get('g2')).toEqual({ weight: 80, derived: false, count: 2, dropLowest: 0 });
    expect(assignmentWeight(w.get('g1'))).toBe(5);
    expect(assignmentWeight(w.get('g2'))).toBe(40);
  });

  it('derives weights from points otherwise', () => {
    const w = computeGroupWeights(groups, false);
    expect(w.get('g1')).toMatchObject({ weight: 20, derived: true }); // 50 of 250 points
    expect(w.get('g2')).toMatchObject({ weight: 80, derived: true });
    const empty = computeGroupWeights([{ id: 'a', name: 'A', position: 1, group_weight: 0, assignments: [assignment({ id: '1', name: 'x', points_possible: 0 })] }, { id: 'b', name: 'B', position: 2, group_weight: 0, assignments: [] }], false);
    expect(empty.get('a')?.weight).toBe(100);
    expect(empty.get('b')?.weight).toBe(0);
  });

  it('flags major assignments', () => {
    expect(isMajorAssignment('exam', 2)).toBe(true);
    expect(isMajorAssignment('homework', 12)).toBe(true);
    expect(isMajorAssignment('quiz', 4)).toBe(false);
  });
});

describe('submissions', () => {
  it('reads visible scores and completion', () => {
    expect(scoreFromSubmission({ score: 18, grade: '18', workflow_state: 'graded', submitted_at: '2026-10-01T00:00:00Z' })).toBe(18);
    expect(scoreFromSubmission({ score: 18, grade: '18', workflow_state: 'graded', submitted_at: null, excused: true })).toBeNull();
    expect(scoreFromSubmission({ score: null, grade: null, workflow_state: 'submitted', submitted_at: '2026-10-01T00:00:00Z' })).toBeNull();
    expect(submissionIsComplete({ score: null, grade: null, workflow_state: 'submitted', submitted_at: '2026-10-01T00:00:00Z' })).toBe(true);
    expect(submissionIsComplete({ score: null, grade: null, workflow_state: 'unsubmitted', submitted_at: null })).toBe(false);
    expect(submissionIsComplete(null)).toBe(false);
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Read <b>ch.&nbsp;4</b> &amp; 5</p><script>x()</script><p>Due&#x3A; Fri</p>')).toBe('Read ch. 4 & 5\nDue: Fri');
    expect(htmlToText('<p>' + 'a'.repeat(50) + '</p>', 10)).toBe('aaaaaaaaa…');
    expect(hasSyllabusContent('<p> </p>')).toBe(false);
    expect(hasSyllabusContent('<p><a href="/files/1">Syllabus.pdf</a></p>')).toBe(true);
    expect(hasSyllabusContent(null)).toBe(false);
  });
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): SafeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  return {
    status,
    ok: status >= 200 && status < 300,
    url: '',
    headers: new Headers(headers),
    body: bytes,
    text: () => text,
    json: <T>() => JSON.parse(text) as T,
  };
}

describe('CanvasClient', () => {
  const base = 'https://school.instructure.com';

  it('follows pagination and sends the token', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fetcher: CanvasFetcher = async (url, options) => {
      calls.push({ url, auth: options.headers?.Authorization });
      if (url.includes('page=2')) return response(200, [{ id: '2', name: 'B' }]);
      return response(200, [{ id: '1', name: 'A' }, { id: '9', access_restricted_by_date: true }], {
        link: `<${base}/api/v1/courses?page=2&per_page=100>; rel="next"`,
      });
    };
    const client = new CanvasClient(base, 'tok', { fetcher, sleepFn: async () => {} });
    const courses = await client.listActiveCourses();
    expect(courses.map((c) => c.id)).toEqual(['1', '2']);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('enrollment_state=active');
    expect(calls[0].url).toContain('include%5B%5D=syllabus_body');
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('refuses pagination links to another site', async () => {
    const fetcher: CanvasFetcher = async () => response(200, [], { link: '<https://evil.example.com/steal>; rel="next"' });
    const client = new CanvasClient(base, 'tok', { fetcher, sleepFn: async () => {} });
    await expect(client.listActiveCourses()).rejects.toBeInstanceOf(CanvasError);
  });

  it('distinguishes a bad token from a forbidden resource', async () => {
    const badToken: CanvasFetcher = async () => response(401, { errors: [{ message: 'Invalid access token.' }] }, { 'www-authenticate': 'Bearer realm="canvas-lms"' });
    await expect(new CanvasClient(base, 't', { fetcher: badToken }).getSelf()).rejects.toMatchObject({ kind: 'auth' });
    const forbidden: CanvasFetcher = async () => response(401, { status: 'unauthorized' });
    await expect(new CanvasClient(base, 't', { fetcher: forbidden }).getSelf()).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('backs off when throttled', async () => {
    let attempts = 0;
    const slept: number[] = [];
    const fetcher: CanvasFetcher = async () => {
      attempts++;
      return attempts < 3 ? response(403, '403 Forbidden (Rate Limit Exceeded)') : response(200, { id: '5', name: 'Ada' });
    };
    const client = new CanvasClient(base, 't', { fetcher, sleepFn: async (ms) => void slept.push(ms) });
    expect((await client.getSelf()).name).toBe('Ada');
    expect(slept).toEqual([1000, 2000]);
  });
});
