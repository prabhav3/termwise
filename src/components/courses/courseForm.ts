// The hand-built course form: state shape, loading from rows, validation, and the save payload.
import type { SaveCourseInput } from '@/data/capture';
import type { Course, GradingComponent } from '@/types/db';

import { fromScaleRows, toScaleRows, type ScaleRow } from './GradeScaleEditor';
import { gradingTotal, type GradingRow } from './GradingEditor';
import type { PolicyValues } from './PoliciesFields';
import type { TermSelection } from './pickers';

export interface CourseForm {
  title: string;
  code: string;
  section: string;
  instructor: string;
  instructorEmail: string;
  location: string;
  credits: number | null;
  targetPercent: number | null;
  color: string;
  meetingDays: number[];
  meetingStart: string | null;
  meetingEnd: string | null;
  startDate: string | null;
  endDate: string | null;
  term: TermSelection;
  grading: GradingRow[];
  scale: ScaleRow[];
  policies: PolicyValues;
}

const EMPTY_POLICIES: PolicyValues = {
  late_policy: null,
  unannounced_quizzes: false,
  attendance_policy: null,
  drop_policy: null,
  extra_credit: null,
};

export function newCourseForm(color: string, activeTermId: string | null): CourseForm {
  return {
    title: '',
    code: '',
    section: '',
    instructor: '',
    instructorEmail: '',
    location: '',
    credits: null,
    targetPercent: null,
    color,
    meetingDays: [],
    meetingStart: null,
    meetingEnd: null,
    startDate: null,
    endDate: null,
    term: activeTermId ? { kind: 'existing', termId: activeTermId } : { kind: 'none' },
    grading: [],
    scale: [],
    policies: EMPTY_POLICIES,
  };
}

export function courseFormFrom(course: Course, components: readonly GradingComponent[]): CourseForm {
  return {
    title: course.title,
    code: course.code ?? '',
    section: course.section ?? '',
    instructor: course.instructor ?? '',
    instructorEmail: course.instructor_email ?? '',
    location: course.location ?? '',
    credits: course.credits === null ? null : Number(course.credits),
    targetPercent: course.target_percent === null ? null : Number(course.target_percent),
    color: course.color,
    meetingDays: [...course.meeting_days],
    meetingStart: course.meeting_start ? course.meeting_start.slice(0, 5) : null,
    meetingEnd: course.meeting_end ? course.meeting_end.slice(0, 5) : null,
    startDate: course.start_date,
    endDate: course.end_date,
    term: course.term_id ? { kind: 'existing', termId: course.term_id } : { kind: 'none' },
    grading: [...components]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((component) => ({
        key: component.id,
        id: component.id,
        name: component.name,
        weight: Number(component.weight),
        expected_count: component.expected_count,
        drop_lowest: component.drop_lowest,
      })),
    scale: toScaleRows(course.grade_scale),
    policies: { ...EMPTY_POLICIES, ...course.policies },
  };
}

export interface CourseFormErrors {
  title: string | null;
  endDate: string | null;
  meetingEnd: string | null;
  term: string | null;
  grading: string | null;
}

export function validateCourseForm(form: CourseForm): CourseFormErrors {
  const unnamed = form.grading.some((row) => !row.name.trim());
  const missingWeight = form.grading.some((row) => row.name.trim() && row.weight === null);
  return {
    title: form.title.trim() ? null : 'Give the course a title',
    endDate: form.startDate && form.endDate && form.endDate < form.startDate ? 'Before the first day' : null,
    meetingEnd:
      form.meetingStart && form.meetingEnd && form.meetingEnd.slice(0, 5) <= form.meetingStart.slice(0, 5) ? 'Ends before it starts' : null,
    term: form.term.kind === 'new' && !form.term.name.trim() ? 'Name the new term' : null,
    grading: unnamed ? 'Name every grade category (or remove the empty ones).' : missingWeight ? 'Give every grade category a weight.' : null,
  };
}

export function hasErrors(errors: CourseFormErrors): boolean {
  return Object.values(errors).some((value) => value !== null);
}

/** True when there are categories and they do not add up to 100%. */
export function weightsOff(form: CourseForm): boolean {
  return form.grading.length > 0 && Math.abs(gradingTotal(form.grading) - 100) > 0.5;
}

const text = (value: string): string | null => (value.trim() ? value.trim() : null);

export function toSaveCourseInput(form: CourseForm, id: string | null): SaveCourseInput {
  const scale = fromScaleRows(form.scale);
  return {
    id,
    course: {
      title: form.title.trim(),
      code: text(form.code),
      section: text(form.section),
      instructor: text(form.instructor),
      instructor_email: text(form.instructorEmail),
      location: text(form.location),
      credits: form.credits,
      target_percent: form.targetPercent,
      color: form.color,
      meeting_days: [...form.meetingDays].sort(),
      meeting_start: form.meetingStart,
      meeting_end: form.meetingEnd,
      start_date: form.startDate,
      end_date: form.endDate,
      // A new course without a scale keeps the column default (the standard A–F scale).
      ...(id === null && scale.length === 0 ? {} : { grade_scale: scale }),
      policies: {
        late_policy: text(form.policies.late_policy ?? ''),
        unannounced_quizzes: form.policies.unannounced_quizzes,
        attendance_policy: text(form.policies.attendance_policy ?? ''),
        drop_policy: text(form.policies.drop_policy ?? ''),
        extra_credit: text(form.policies.extra_credit ?? ''),
      },
    },
    term:
      form.term.kind === 'new'
        ? { kind: 'new', name: form.term.name.trim() }
        : { kind: 'existing', termId: form.term.kind === 'existing' ? form.term.termId : null },
    components: form.grading
      .filter((row) => row.name.trim())
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        weight: row.weight ?? 0,
        expected_count: row.expected_count,
        drop_lowest: row.drop_lowest,
      })),
  };
}
