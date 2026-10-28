// Capture, review import and hand-built courses: the multi-table writes behind the upload,
// review, course-edit and item screens. Single-row edits use the per-table hooks; these
// mutations write several tables at once and refresh every cache they touch.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import { normalizeExtraction, type ExtractedTextbook, type SyllabusExtraction } from '@shared/extraction.ts';

import { AppError, toAppError } from '@/lib/functions';
import { planImport, planTocImport, type ImportPlan, type MergeTarget, type TermChoice } from '@/lib/import-extraction';
import { normalizeCourseRow } from '@/lib/json-columns';
import { replan } from '@/lib/planner';
import { removeStoredFiles, uploadCapturedFiles, type CapturedFile } from '@/lib/uploads';
import { supabase } from '@/lib/supabase';
import { nextCourseColor } from '@/theme/tokens';
import type { Course, GradingComponent, SyllabusUpload, Textbook, UUID } from '@/types/db';

import { componentsQueryOptions } from './components';
import { coursesQueryOptions } from './courses';
import type { NewRow, RowPatch } from './database';
import { check, chunk, invalidateAll, requireUserId, unwrap, upsertInList } from './helpers';
import { itemsQueryOptions } from './items';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';
import { termEventsQueryOptions } from './termEvents';
import { termsQueryOptions } from './terms';
import { textbooksQueryOptions } from './textbooks';
import { uploadsQueryOptions, useCreateUpload, useDeleteUpload, useStartParse, useUpdateUpload } from './uploads';

const WRITE_BATCH = 200;
const UPDATE_PARALLEL = 8;

/** Every table an import or a course save can write. */
const COURSE_TABLES = [
  queryKeys.terms(),
  queryKeys.courses(),
  queryKeys.components(),
  queryKeys.items(),
  queryKeys.textbooks(),
  queryKeys.termEvents(),
] as const;

// ---- uploads in flight ---------------------------------------------------------------------------

/** Parse jobs the student still has to act on or wait for (anything not imported yet), newest first. */
export function useActiveUploads() {
  return useQuery({
    ...uploadsQueryOptions(),
    select: (uploads) => uploads.filter((upload) => upload.status !== 'imported'),
  });
}

export interface SubmitCaptureInput {
  kind: SyllabusUpload['kind'];
  courseId: UUID | null;
  files: readonly CapturedFile[];
  pastedText: string | null;
  /** Called before each file and once at the end: (filesDone, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface SubmitCaptureResult {
  uploadId: UUID;
  /** The parse could not be started (the review screen offers Retry). */
  parseError: AppError | null;
}

/**
 * Creates the syllabus_uploads row, uploads every file to `syllabi/<uid>/<upload_id>/<n>.<ext>`,
 * records the files, then starts parse-syllabus. A failed file upload removes the row again.
 */
export function useSubmitCapture() {
  const createUpload = useCreateUpload();
  const updateUpload = useUpdateUpload();
  const deleteUpload = useDeleteUpload();
  const startParse = useStartParse();
  return useMutation({
    mutationFn: async (input: SubmitCaptureInput): Promise<SubmitCaptureResult> => {
      const text = input.pastedText?.trim() || null;
      if (input.files.length === 0 && !text) throw new AppError('bad_request', 'Add a file, a photo, or some text first.');
      const userId = await requireUserId();
      const upload = await createUpload.mutateAsync({
        kind: input.kind,
        course_id: input.courseId,
        source: input.files.length === 0 ? 'paste' : 'upload',
        pasted_text: text,
        files: [],
      });
      if (input.files.length > 0) {
        try {
          const stored = await uploadCapturedFiles({ userId, uploadId: upload.id, files: input.files, onProgress: input.onProgress });
          await updateUpload.mutateAsync({ id: upload.id, changes: { files: stored } });
        } catch (error) {
          await deleteUpload.mutateAsync(upload.id).catch(() => undefined);
          throw toAppError(error);
        }
      }
      try {
        await startParse.mutateAsync(upload.id);
        return { uploadId: upload.id, parseError: null };
      } catch (error) {
        return { uploadId: upload.id, parseError: toAppError(error) };
      }
    },
  });
}

/** Deletes a parse job and its stored files (a failed or unwanted upload). */
export function useDiscardUpload() {
  const deleteUpload = useDeleteUpload();
  return useMutation({
    mutationFn: async (upload: Pick<SyllabusUpload, 'id' | 'files'>) => {
      await deleteUpload.mutateAsync(upload.id);
      await removeStoredFiles(upload.files.map((file) => file.path));
      return upload.id;
    },
  });
}

// ---- review import ---------------------------------------------------------------------------------

async function insertRows<T extends 'grading_components' | 'textbooks' | 'items' | 'term_events'>(
  table: T,
  rows: readonly NewRow<T>[],
): Promise<void> {
  for (const batch of chunk(rows, WRITE_BATCH)) {
    // Each table's NewRow matches its insert type; supabase-js cannot narrow the generic table name.
    check(await supabase.from(table as 'items').insert(batch as unknown as NewRow<'items'>[]));
  }
}

async function updateRows<T extends 'grading_components' | 'textbooks' | 'items'>(
  table: T,
  updates: readonly { id: UUID; changes: RowPatch<T> }[],
): Promise<void> {
  for (const batch of chunk(updates, UPDATE_PARALLEL)) {
    const results = await Promise.all(
      batch.map(({ id, changes }) => supabase.from(table as 'items').update(changes as RowPatch<'items'>).eq('id', id)),
    );
    for (const result of results) check(result);
  }
}

async function writeImportPlan(plan: ImportPlan): Promise<void> {
  if (plan.newTerm) check(await supabase.from('terms').insert(plan.newTerm));
  try {
    if (plan.newCourse) check(await supabase.from('courses').insert(plan.newCourse));
    else if (plan.courseChanges) check(await supabase.from('courses').update(plan.courseChanges).eq('id', plan.courseId));
    await insertRows('grading_components', plan.components.create);
    await updateRows('grading_components', plan.components.update);
    await insertRows('textbooks', plan.textbooks.create);
    await updateRows('textbooks', plan.textbooks.update);
    await insertRows('items', plan.items.create);
    await updateRows('items', plan.items.update);
    await insertRows('term_events', plan.termEvents.create);
  } catch (error) {
    // A brand-new course is all-or-nothing: deleting it cascades to everything written above.
    if (plan.newCourse) await supabase.from('courses').delete().eq('id', plan.courseId);
    if (plan.newTerm) await supabase.from('terms').delete().eq('id', plan.newTerm.id);
    const appError = toAppError(error);
    if (!plan.newCourse) {
      throw new AppError(appError.code, `Only part of the syllabus was added before an error: ${appError.message}`, { cause: error });
    }
    throw appError;
  }
}

async function loadMergeTarget(client: QueryClient, courseId: UUID | null): Promise<{ target: MergeTarget | null; courses: Course[] }> {
  const courses = await client.fetchQuery({ ...coursesQueryOptions(), staleTime: 0 });
  const course = courseId ? courses.find((c) => c.id === courseId) : undefined;
  if (!course) return { target: null, courses };
  const [components, items, textbooks, termEvents] = await Promise.all([
    client.fetchQuery({ ...componentsQueryOptions(), staleTime: 0 }),
    client.fetchQuery({ ...itemsQueryOptions(), staleTime: 0 }),
    client.fetchQuery({ ...textbooksQueryOptions(), staleTime: 0 }),
    client.fetchQuery({ ...termEventsQueryOptions(), staleTime: 0 }),
  ]);
  return {
    courses,
    target: {
      course,
      components: components.filter((c) => c.course_id === course.id),
      items: items.filter((i) => i.course_id === course.id),
      textbooks: textbooks.filter((t) => t.course_id === course.id),
      termEvents: termEvents.filter((e) => e.course_id === course.id),
    },
  };
}

export interface ImportSyllabusResult {
  plan: ImportPlan;
  /** The data is saved; only the follow-up replan failed (it retries on the next edit). */
  replanError: AppError | null;
}

/**
 * Writes the reviewed draft (a new course, or gap-filling into the upload's course), marks the
 * upload imported, then replans once for the whole import.
 */
export function useImportSyllabus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      upload: Pick<SyllabusUpload, 'id' | 'course_id'>;
      draft: SyllabusExtraction;
      termChoice: TermChoice;
    }): Promise<ImportSyllabusResult> => {
      const draft = normalizeExtraction(input.draft);
      const [terms, { target, courses }] = await Promise.all([
        client.fetchQuery({ ...termsQueryOptions(), staleTime: 0 }),
        loadMergeTarget(client, input.upload.course_id),
      ]);
      const plan = planImport(draft, {
        terms,
        courseCount: courses.length,
        target,
        termChoice: input.termChoice,
        newId: randomUUID,
      });
      await writeImportPlan(plan);
      const marked = await supabase
        .from('syllabus_uploads')
        .update({ status: 'imported', course_id: plan.courseId, extraction: input.draft, progress_note: null, error: null })
        .eq('id', input.upload.id);
      await invalidateAll(client, [...COURSE_TABLES, queryKeys.uploads()]);
      // The rows are in; a failed status write only leaves the upload listed as "ready to review".
      if (marked.error) await client.invalidateQueries({ queryKey: queryKeys.upload(input.upload.id) });
      let replanError: AppError | null = null;
      try {
        await replan();
      } catch (error) {
        replanError = toAppError(error);
      }
      return { plan, replanError };
    },
  });
}

/** Saves a reviewed table of contents as a new textbook or as the chapter map of an existing one. */
export function useImportToc() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      upload: Pick<SyllabusUpload, 'id'>;
      book: ExtractedTextbook;
      courseId: UUID;
      existing: Textbook | null;
      warnings: unknown[];
    }): Promise<{ textbookId: UUID }> => {
      const plan = planTocImport(input.book, { courseId: input.courseId, existing: input.existing }, randomUUID);
      if (plan.create) check(await supabase.from('textbooks').insert(plan.create));
      if (plan.update) check(await supabase.from('textbooks').update(plan.update.changes).eq('id', plan.update.id));
      await supabase
        .from('syllabus_uploads')
        .update({
          status: 'imported',
          course_id: input.courseId,
          extraction: { textbook: input.book, warnings: input.warnings },
          progress_note: null,
          error: null,
        })
        .eq('id', input.upload.id);
      return { textbookId: plan.textbookId };
    },
    onSuccess: async () => {
      await invalidateAll(client, [queryKeys.textbooks(), queryKeys.uploads()]);
      notifyPlanInputsChanged();
    },
  });
}

// ---- hand-built courses ------------------------------------------------------------------------------

/** A grading row in the course editor; rows without `id` are new. */
export interface ComponentInput {
  id?: UUID;
  name: string;
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
}

export type CourseFields = Omit<NewRow<'courses'>, 'id' | 'term_id' | 'color'> & { color?: string };

export interface SaveCourseInput {
  /** null creates a course. */
  id: UUID | null;
  course: CourseFields;
  /** `existing` keeps the course's term (or none); `new` creates the named term first. */
  term: { kind: 'existing'; termId: UUID | null } | { kind: 'new'; name: string };
  components: readonly ComponentInput[];
}

function componentChanged(current: GradingComponent, next: ComponentInput, sortOrder: number): RowPatch<'grading_components'> | null {
  const changes: RowPatch<'grading_components'> = {};
  if (current.name !== next.name) changes.name = next.name;
  if (Number(current.weight) !== next.weight) changes.weight = next.weight;
  if (current.expected_count !== next.expected_count) changes.expected_count = next.expected_count;
  if (current.drop_lowest !== next.drop_lowest) changes.drop_lowest = next.drop_lowest;
  if (current.sort_order !== sortOrder) changes.sort_order = sortOrder;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Creates or updates a course with its whole grading breakdown in one go (one replan). */
export function useSaveCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCourseInput): Promise<Course> => {
      let termId: UUID | null = input.term.kind === 'existing' ? input.term.termId : null;
      if (input.term.kind === 'new') {
        const term = unwrap(await supabase.from('terms').insert({ name: input.term.name.trim(), is_active: true }).select('*').single());
        termId = term.id;
      }

      let course: Course;
      if (input.id) {
        course = unwrap(
          await supabase
            .from('courses')
            .update({ ...input.course, term_id: termId })
            .eq('id', input.id)
            .select('*')
            .single(),
        );
      } else {
        const existing = await client.fetchQuery(coursesQueryOptions());
        course = unwrap(
          await supabase
            .from('courses')
            .insert({ ...input.course, term_id: termId, color: input.course.color ?? nextCourseColor(existing.length) })
            .select('*')
            .single(),
        );
      }

      const all = await client.fetchQuery({ ...componentsQueryOptions(), staleTime: 0 });
      const current = all.filter((component) => component.course_id === course.id);
      const keep = new Set(input.components.flatMap((row) => (row.id ? [row.id] : [])));
      const removed = current.filter((component) => !keep.has(component.id)).map((component) => component.id);
      if (removed.length > 0) check(await supabase.from('grading_components').delete().in('id', removed));

      const updates: { id: UUID; changes: RowPatch<'grading_components'> }[] = [];
      const creates: NewRow<'grading_components'>[] = [];
      input.components.forEach((row, sortOrder) => {
        const existing = row.id ? current.find((component) => component.id === row.id) : undefined;
        if (existing) {
          const changes = componentChanged(existing, row, sortOrder);
          if (changes) updates.push({ id: existing.id, changes });
          return;
        }
        creates.push({
          course_id: course.id,
          name: row.name,
          weight: row.weight,
          expected_count: row.expected_count,
          drop_lowest: row.drop_lowest,
          source: 'manual',
          sort_order: sortOrder,
        });
      });
      await updateRows('grading_components', updates);
      await insertRows('grading_components', creates);
      return course;
    },
    onSuccess: async (course) => {
      upsertInList(client, queryKeys.courses(), normalizeCourseRow(course));
      await invalidateAll(client, [queryKeys.terms(), queryKeys.components(), queryKeys.items()]);
      notifyPlanInputsChanged();
    },
  });
}
