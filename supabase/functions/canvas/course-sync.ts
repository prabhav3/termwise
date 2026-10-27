// Pulls one Canvas course into its Termwise course: assignment groups → grading components,
// assignments → items (matched against syllabus items when the course has them), and the
// resulting discrepancies. Used by both `import` and `sync`, so every step is idempotent.
//
// Syllabus-first rule: when the course already has syllabus grading components, Canvas groups
// are linked to them (never added next to them, which would double-count weights) and weight
// differences become weight_mismatch discrepancies. Syllabus items matched to an assignment get
// canvas_assignment_id + lms_* fields but keep the syllabus due date; Canvas-only assignments
// become source 'canvas' items, which follow Canvas on every sync.
import { toHHMM } from '../_shared/calendar-model.ts';
import {
  buildWeightDiscrepancies,
  type CanvasAssignmentGroup,
  type CanvasClient,
  type CanvasCourse,
  type CanvasItemFields,
  computeGroupWeights,
  type GroupWeight,
  mapCanvasAssignment,
  matchGroupsToComponents,
} from '../_shared/canvas-client.ts';
import { saveDiscrepancies } from '../_shared/discrepancy-store.ts';
import { HttpError } from '../_shared/http.ts';
import {
  buildItemDiscrepancies,
  type DiscrepancyRecord,
  type LmsSide,
  matchCandidates,
  type SyllabusSide,
  titleSimilarity,
} from '../_shared/match.ts';
import { COMPONENT_COLUMNS, type ComponentRow, type Db, dbFail, ITEM_COLUMNS, isSyllabusSourced, type ItemRow } from './rows.ts';

export interface SyncContext {
  userDb: Db;
  adminDb: Db;
  userId: string;
  connectionId: string;
  client: CanvasClient;
  timeZone: string;
  includeScores: boolean;
}

export interface CourseSyncCounts {
  components_created: number;
  items_created: number;
  items_updated: number;
}

export function discrepancyPrefix(connectionId: string, courseId: string): string {
  return `canvas:${connectionId}:${courseId}`;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadComponents(db: Db, courseId: string): Promise<ComponentRow[]> {
  const { data, error } = await db
    .from('grading_components')
    .select(COMPONENT_COLUMNS)
    .eq('course_id', courseId)
    .order('sort_order')
    .overrideTypes<ComponentRow[], { merge: false }>();
  if (error) dbFail('component lookup', error);
  return data ?? [];
}

async function loadItems(db: Db, courseId: string): Promise<ItemRow[]> {
  const { data, error } = await db
    .from('items')
    .select(ITEM_COLUMNS)
    .eq('course_id', courseId)
    .overrideTypes<ItemRow[], { merge: false }>();
  if (error) dbFail('item lookup', error);
  return data ?? [];
}

/** Canvas assignment ids already attached to items in the student's other courses. */
async function assignmentsLinkedElsewhere(db: Db, courseId: string, assignmentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < assignmentIds.length; i += 150) {
    const { data, error } = await db
      .from('items')
      .select('canvas_assignment_id')
      .in('canvas_assignment_id', assignmentIds.slice(i, i + 150))
      .neq('course_id', courseId)
      .overrideTypes<Array<{ canvas_assignment_id: string }>, { merge: false }>();
    if (error) dbFail('item lookup', error);
    for (const row of data ?? []) out.add(row.canvas_assignment_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface ComponentSync {
  created: number;
  /** Components that grade a Canvas group's assignments (several when one group covers many). */
  forGroup: (groupId: string) => ComponentRow[];
  validIds: Set<string>;
  syllabusMode: boolean;
  weightDiscrepancies: DiscrepancyRecord[];
}

function componentFields(group: CanvasAssignmentGroup, weight: GroupWeight, index: number) {
  return {
    name: group.name.trim().slice(0, 120) || 'Assignments',
    weight: Math.min(100, Math.max(0, weight.weight)),
    expected_count: weight.count,
    drop_lowest: weight.dropLowest,
    sort_order: Number.isFinite(group.position) ? group.position : index,
    source: 'canvas' as const,
    canvas_group_id: String(group.id),
  };
}

async function syncComponents(
  ctx: SyncContext,
  courseId: string,
  groups: CanvasAssignmentGroup[],
  weights: Map<string, GroupWeight>,
  components: ComponentRow[],
): Promise<ComponentSync> {
  const syllabusComponents = components.filter((c) => c.source !== 'canvas');
  const canvasComponents = components.filter((c) => c.source === 'canvas');
  const byGroup = new Map<string, ComponentRow[]>();

  if (syllabusComponents.length > 0) {
    const matched = matchGroupsToComponents(groups, syllabusComponents);
    const relink = [...matched].flatMap(([groupId, list]) =>
      list.filter((c) => c.canvas_group_id !== groupId).map((c) => ({ id: c.id, groupId })),
    );
    await Promise.all(
      relink.map(async ({ id, groupId }) => {
        const { error } = await ctx.userDb.from('grading_components').update({ canvas_group_id: groupId }).eq('id', id);
        if (error) dbFail('component link', error);
      }),
    );
    for (const [groupId, list] of matched) byGroup.set(groupId, list);
    // Canvas components left over from an import made before the syllabus was added.
    for (const c of canvasComponents) {
      if (c.canvas_group_id && !byGroup.has(c.canvas_group_id)) byGroup.set(c.canvas_group_id, [c]);
    }
    const scope = discrepancyPrefix(ctx.connectionId, courseId);
    const weightDiscrepancies = buildWeightDiscrepancies(
      scope,
      groups.flatMap((group) => {
        const weight = weights.get(String(group.id));
        const list = matched.get(String(group.id));
        return weight && list ? [{ components: list, group, weight }] : [];
      }),
    );
    return {
      created: 0,
      forGroup: (groupId) => byGroup.get(groupId) ?? [],
      validIds: new Set(components.map((c) => c.id)),
      syllabusMode: true,
      weightDiscrepancies,
    };
  }

  // Canvas mode: one component per assignment group that carries work or weight.
  const existingByGroup = new Map(canvasComponents.filter((c) => c.canvas_group_id).map((c) => [c.canvas_group_id as string, c]));
  const inserts: Array<ReturnType<typeof componentFields> & { course_id: string }> = [];
  const updates: Array<ReturnType<typeof componentFields> & { id: string; course_id: string }> = [];
  const keep = new Set<string>();
  groups.forEach((group, index) => {
    const weight = weights.get(String(group.id));
    if (!weight || (weight.count === 0 && weight.weight === 0)) return;
    const fields = componentFields(group, weight, index);
    const existing = existingByGroup.get(fields.canvas_group_id);
    if (!existing) {
      inserts.push({ course_id: courseId, ...fields });
      return;
    }
    keep.add(existing.id);
    byGroup.set(fields.canvas_group_id, [existing]);
    const changed =
      existing.name !== fields.name ||
      Number(existing.weight) !== fields.weight ||
      existing.expected_count !== fields.expected_count ||
      existing.drop_lowest !== fields.drop_lowest ||
      existing.sort_order !== fields.sort_order;
    if (changed) updates.push({ id: existing.id, course_id: courseId, ...fields });
  });

  const stale = canvasComponents.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (stale.length > 0) {
    const { error } = await ctx.userDb.from('grading_components').delete().in('id', stale);
    if (error) dbFail('component cleanup', error);
  }
  if (updates.length > 0) {
    const { error } = await ctx.userDb.from('grading_components').upsert(updates, { onConflict: 'id' });
    if (error) dbFail('component update', error);
  }
  if (inserts.length > 0) {
    const { data, error } = await ctx.userDb
      .from('grading_components')
      .insert(inserts)
      .select(COMPONENT_COLUMNS)
      .overrideTypes<ComponentRow[], { merge: false }>();
    if (error) dbFail('component save', error);
    for (const row of data ?? []) if (row.canvas_group_id) byGroup.set(row.canvas_group_id, [row]);
  }
  const validIds = new Set<string>();
  for (const list of byGroup.values()) for (const c of list) validIds.add(c.id);
  return { created: inserts.length, forGroup: (groupId) => byGroup.get(groupId) ?? [], validIds, syllabusMode: false, weightDiscrepancies: [] };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const INSTANT_FIELDS = new Set(['lms_due_at', 'lms_lock_at', 'lms_unlock_at', 'completed_at']);

function sameValue(field: string, a: unknown, b: unknown): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  if (INSTANT_FIELDS.has(field) && typeof x === 'string' && typeof y === 'string') return Date.parse(x) === Date.parse(y);
  if (field === 'due_time' && typeof x === 'string' && typeof y === 'string') return toHHMM(x) === toHHMM(y);
  if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y);
  return x === y;
}

function changed(current: ItemRow, next: Record<string, unknown>): boolean {
  return Object.entries(next).some(([field, value]) => !sameValue(field, (current as unknown as Record<string, unknown>)[field], value));
}

type ItemStatus = ItemRow['status'];

/** Canvas can mark work done (submitted / graded / excused) but never reopens it. */
function nextStatus(current: ItemStatus, complete: boolean): ItemStatus {
  return complete && (current === 'todo' || current === 'in_progress') ? 'done' : current;
}

function syllabusSide(item: ItemRow): SyllabusSide {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    due_date: item.due_date,
    due_time: toHHMM(item.due_time),
    is_major: item.is_major,
    points_possible: item.points_possible === null ? null : Number(item.points_possible),
  };
}

function lmsSide(fields: CanvasItemFields): LmsSide {
  return {
    external_id: fields.external_id,
    title: fields.title,
    due_date: fields.due_date,
    due_time: fields.due_time,
    lock_date: fields.lock_date,
    lock_time: fields.lock_time,
    points_possible: fields.points_possible,
  };
}

/** Canvas-generated columns (Roll Call attendance) that no syllabus lists as work. */
function isCanvasBookkeeping(fields: CanvasItemFields): boolean {
  return /^roll call attendance$/i.test(fields.title);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function syncCanvasCourse(ctx: SyncContext, canvasCourse: CanvasCourse, courseId: string): Promise<CourseSyncCounts> {
  const groups = await ctx.client.listAssignmentGroups(String(canvasCourse.id), ctx.includeScores);
  const weights = computeGroupWeights(groups, canvasCourse.apply_assignment_group_weights === true);
  const [components, items] = await Promise.all([loadComponents(ctx.userDb, courseId), loadItems(ctx.userDb, courseId)]);
  const componentSync = await syncComponents(ctx, courseId, groups, weights, components);

  const assignments = new Map<string, CanvasItemFields>();
  for (const group of groups) {
    for (const assignment of group.assignments ?? []) {
      if (assignment.published === false) continue;
      const fields = mapCanvasAssignment(
        { ...assignment, assignment_group_id: String(group.id) },
        { timeZone: ctx.timeZone, group: weights.get(String(group.id)), includeScores: ctx.includeScores },
      );
      assignments.set(fields.external_id, fields);
    }
  }
  const elsewhere = await assignmentsLinkedElsewhere(ctx.userDb, courseId, [...assignments.keys()]);

  const pickComponent = (fields: CanvasItemFields, title: string): string | null => {
    const list = componentSync.forGroup(fields.group_id);
    if (list.length <= 1) return list[0]?.id ?? null;
    return list.reduce((best, c) => (titleSimilarity(title, c.name) > titleSimilarity(title, best.name) ? c : best)).id;
  };

  // Which assignment each syllabus item stands for.
  const syllabusItems = items.filter(isSyllabusSourced);
  const linked = new Map<string, ItemRow>();
  const unlinked: ItemRow[] = [];
  for (const item of syllabusItems) {
    const id = item.canvas_assignment_id;
    if (id && assignments.has(id) && !linked.has(id)) linked.set(id, item);
    else unlinked.push(item);
  }
  const canvasItems = new Map<string, ItemRow>();
  const vanished: ItemRow[] = [];
  for (const item of items) {
    if (isSyllabusSourced(item) || !item.canvas_assignment_id) continue;
    if (assignments.has(item.canvas_assignment_id)) canvasItems.set(item.canvas_assignment_id, item);
    else vanished.push(item);
  }

  const match = matchCandidates(
    unlinked.map((item) => ({ id: item.id, title: item.title, kind: item.kind, date: item.due_date, item })),
    [...assignments.values()]
      .filter((f) => !linked.has(f.external_id) && !elsewhere.has(f.external_id))
      .map((f) => ({ id: f.external_id, title: f.title, kind: f.kind, date: f.due_date })),
  );
  for (const pair of match.pairs) linked.set(pair.b.id, pair.a.item);
  const stillUnlinked = match.unmatchedA.map((c) => c.item);

  const now = new Date().toISOString();
  const deletes: string[] = [];
  const syllabusRows: Array<Record<string, unknown>> = [];
  for (const [assignmentId, item] of linked) {
    const fields = assignments.get(assignmentId) as CanvasItemFields;
    const duplicate = canvasItems.get(assignmentId);
    if (duplicate) {
      // The syllabus item takes over this assignment; the Canvas copy goes away.
      deletes.push(duplicate.id);
      canvasItems.delete(assignmentId);
    }
    const status = nextStatus(item.status, fields.complete || duplicate?.status === 'done');
    const row = {
      id: item.id,
      course_id: item.course_id,
      title: item.title,
      canvas_assignment_id: assignmentId,
      lms_due_at: fields.lms_due_at,
      lms_lock_at: fields.lms_lock_at,
      lms_unlock_at: fields.lms_unlock_at,
      points_possible: item.points_possible ?? fields.points_possible,
      component_id: item.component_id ?? pickComponent(fields, item.title),
      score: fields.score ?? item.score ?? duplicate?.score ?? null,
      status,
      completed_at: status === 'done' ? (item.completed_at ?? duplicate?.completed_at ?? now) : item.completed_at,
    };
    if (changed(item, row) || duplicate) syllabusRows.push(row);
  }
  // Links to assignments Canvas no longer has.
  for (const item of stillUnlinked) {
    if (!item.canvas_assignment_id) continue;
    syllabusRows.push({
      id: item.id,
      course_id: item.course_id,
      title: item.title,
      canvas_assignment_id: null,
      lms_due_at: null,
      lms_lock_at: null,
      lms_unlock_at: null,
      points_possible: item.points_possible,
      component_id: item.component_id,
      score: item.score,
      status: item.status,
      completed_at: item.completed_at,
    });
  }
  // Canvas copies of deleted assignments go too, unless the student finished or scored them.
  for (const item of vanished) if (item.status !== 'done' && item.score === null) deletes.push(item.id);

  const canvasRows: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  for (const fields of assignments.values()) {
    if (linked.has(fields.external_id) || elsewhere.has(fields.external_id)) continue;
    const content = {
      title: fields.title,
      kind: fields.kind,
      description: fields.description,
      assigned_date: fields.assigned_date,
      due_date: fields.due_date,
      due_time: fields.due_time,
      lms_due_at: fields.lms_due_at,
      lms_lock_at: fields.lms_lock_at,
      lms_unlock_at: fields.lms_unlock_at,
      points_possible: fields.points_possible,
      is_major: fields.is_major,
    };
    const existing = canvasItems.get(fields.external_id);
    if (!existing) {
      inserts.push({
        course_id: courseId,
        ...content,
        component_id: pickComponent(fields, fields.title),
        score: fields.score,
        status: fields.complete ? 'done' : 'todo',
        completed_at: fields.complete ? now : null,
        source: 'canvas',
        canvas_assignment_id: fields.external_id,
      });
      continue;
    }
    const status = nextStatus(existing.status, fields.complete);
    const fallbackComponent = existing.component_id && componentSync.validIds.has(existing.component_id) ? existing.component_id : null;
    const row = {
      id: existing.id,
      course_id: existing.course_id,
      ...content,
      component_id: pickComponent(fields, fields.title) ?? fallbackComponent,
      score: fields.score ?? existing.score,
      status,
      completed_at: status === 'done' ? (existing.completed_at ?? now) : existing.completed_at,
    };
    if (changed(existing, row)) canvasRows.push(row);
  }

  if (deletes.length > 0) {
    const { error } = await ctx.userDb.from('items').delete().in('id', deletes);
    if (error) dbFail('item cleanup', error);
  }
  for (const rows of [syllabusRows, canvasRows]) {
    if (rows.length === 0) continue;
    const { error } = await ctx.userDb.from('items').upsert(rows, { onConflict: 'id' });
    if (isUniqueViolation(error)) throw new HttpError('conflict', 'Canvas is already syncing this course. Try again in a moment.');
    if (error) dbFail('item update', error);
  }
  if (inserts.length > 0) {
    const { error } = await ctx.userDb.from('items').insert(inserts);
    if (isUniqueViolation(error)) throw new HttpError('conflict', 'Canvas is already syncing this course. Try again in a moment.');
    if (error) dbFail('item save', error);
  }

  // Discrepancies only mean something when there is a syllabus to compare with.
  const hasSyllabusItems = syllabusItems.length > 0;
  const current: DiscrepancyRecord[] = [...componentSync.weightDiscrepancies];
  if (hasSyllabusItems) {
    const linkedItemIds = new Set([...linked.values()].map((i) => i.id));
    current.push(
      ...buildItemDiscrepancies({
        scope: discrepancyPrefix(ctx.connectionId, courseId),
        lmsName: 'Canvas',
        pairs: [...linked].map(([assignmentId, item]) => ({
          syllabus: syllabusSide(item),
          lms: lmsSide(assignments.get(assignmentId) as CanvasItemFields),
        })),
        unmatchedSyllabus: syllabusItems.filter((i) => !linkedItemIds.has(i.id)).map(syllabusSide),
        unmatchedLms: [...assignments.values()]
          .filter((f) => !linked.has(f.external_id) && !elsewhere.has(f.external_id) && !isCanvasBookkeeping(f))
          .map(lmsSide),
        checkLocks: true,
        checkPoints: true,
      }),
    );
  }
  await saveDiscrepancies(
    ctx.adminDb,
    { userId: ctx.userId, connectionId: ctx.connectionId, courseId, prefix: discrepancyPrefix(ctx.connectionId, courseId) },
    current,
  );

  return {
    components_created: componentSync.created,
    items_created: inserts.length,
    items_updated: syllabusRows.length + canvasRows.length,
  };
}
