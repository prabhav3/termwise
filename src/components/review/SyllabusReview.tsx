// The editable review of a parsed syllabus: warnings first, then every section (collapsed so a
// long syllabus stays calm), then one Import that writes everything and replans once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import type { SyllabusExtraction } from '@shared/extraction.ts';

import { invalidChapters } from '@/components/courses/ChapterMapEditor';
import { GradeScaleEditor } from '@/components/courses/GradeScaleEditor';
import { GradingEditor, gradingTotal, type GradingRow } from '@/components/courses/GradingEditor';
import { PoliciesFields } from '@/components/courses/PoliciesFields';
import { TermPicker, type TermSelection } from '@/components/courses/pickers';
import { Button, ErrorBanner, NBText, Screen, useToast } from '@/components/ui';
import { useCourse, useTerms, useUpdateUpload } from '@/data';
import { useImportSyllabus } from '@/data/capture';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { suggestTermChoice, type ImportPlan, type TermChoice } from '@/lib/import-extraction';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';
import type { SyllabusUpload } from '@/types/db';

import { confirmDiscardUpload } from './confirm';
import { CourseInfoEditor } from './CourseInfoEditor';
import {
  fromDraft,
  newDraftItem,
  newDraftTextbook,
  renameComponents,
  renameTextbook,
  toDraft,
  type DraftComponent,
  type ReviewDraft,
} from './draft';
import { DraftItemList } from './DraftItemList';
import { DraftItemSheet } from './DraftItemSheet';
import { DraftTextbooksEditor } from './DraftTextbooksEditor';
import { ReviewSection } from './ReviewSection';
import { TermEventsEditor } from './TermEventsEditor';
import { WarningsCard } from './WarningsCard';

type SectionKey = 'grading' | 'scale' | 'items' | 'events' | 'textbooks' | 'policies';

const CLOSED: Record<SectionKey, boolean> = {
  grading: false,
  scale: false,
  items: true,
  events: false,
  textbooks: false,
  policies: false,
};

function toSelection(choice: TermChoice): TermSelection {
  return choice.kind === 'new' ? { kind: 'new', name: choice.name } : choice;
}

function toTermChoice(selection: TermSelection, course: SyllabusExtraction['course']): TermChoice {
  if (selection.kind !== 'new') return selection;
  return { kind: 'new', name: selection.name, start_date: course.start_date, end_date: course.end_date };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function importSummary(summary: ImportPlan['summary']): string {
  const parts = [plural(summary.itemsCreated, 'deadline') + ' added'];
  if (summary.itemsMerged > 0) parts.push(`${summary.itemsMerged} matched to ones you had`);
  if (summary.termEventsCreated > 0) parts.push(plural(summary.termEventsCreated, 'break'));
  return `${parts.join(' · ')}. Your plan is updating.`;
}

export interface SyllabusReviewProps {
  upload: SyllabusUpload;
  extraction: SyllabusExtraction;
  onImported: (courseId: string) => void;
  /** Deletes the upload (already confirmed). */
  onDiscard: () => void;
  discarding: boolean;
}

export function SyllabusReview({ upload, extraction, onImported, onDiscard, discarding }: SyllabusReviewProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const terms = useTerms();
  const target = useCourse(upload.course_id);
  const importer = useImportSyllabus();
  const { mutate: saveUpload } = useUpdateUpload();

  const [draft, setDraftState] = useState<ReviewDraft>(() => toDraft(extraction));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(CLOSED);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [termPick, setTermPick] = useState<TermSelection | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const setDraft = (update: (current: ReviewDraft) => ReviewDraft) => {
    setDraftState(update);
    setDirty(true);
  };
  const openSection = (key: SectionKey, value = true) => setOpen((current) => ({ ...current, [key]: value }));

  // Leaving mid-review keeps the edits on the upload row, so nothing typed is lost.
  const latest = useRef({ draft, dirty });
  useEffect(() => {
    latest.current = { draft, dirty };
  }, [draft, dirty]);
  useEffect(
    () => () => {
      const { draft: last, dirty: changed } = latest.current;
      if (changed) saveUpload({ id: upload.id, changes: { extraction: fromDraft(last) } });
    },
    [upload.id, saveUpload],
  );

  const suggested = useMemo(() => (terms.data ? toSelection(suggestTermChoice(extraction, terms.data)) : null), [terms.data, extraction]);
  const term: TermSelection = termPick ?? suggested ?? { kind: 'none' };
  const merging = upload.course_id !== null;
  const targetCourse = target.data ?? null;

  const componentNames = draft.grading.map((row) => row.name.trim()).filter((name) => name.length > 0);
  const textbookTitles = draft.textbooks.map((book) => book.title.trim()).filter((title) => title.length > 0);
  const editingItem = draft.items.find((item) => item.key === editingKey) ?? null;
  const undated = draft.items.filter((item) => !item.due_date).length;
  const total = gradingTotal(draft.grading);

  const titleError = submitted && !merging && !draft.course.title.trim() ? 'Add the course title' : null;
  const problems: string[] = [];
  if (titleError) problems.push('Give the course a title.');
  if (!merging && term.kind === 'new' && !term.name.trim()) problems.push('Name the new term, or pick another.');
  if (draft.events.some((event) => event.end_date < event.start_date)) problems.push('A break ends before it starts.');
  if (draft.events.some((event) => !event.title.trim())) problems.push('Every break needs a name.');
  if (draft.textbooks.some((book) => invalidChapters(book.chapters).length > 0)) problems.push('A chapter ends before it starts.');
  if (draft.grading.some((row) => !row.name.trim() && (row.weight ?? 0) > 0)) problems.push('Name every grade category.');

  // ---- edits ---------------------------------------------------------------------------------

  const setGrading = (rows: GradingRow[]) => {
    const grading: DraftComponent[] = rows.map((row) => ({ notes: draft.grading.find((old) => old.key === row.key)?.notes ?? null, ...row }));
    setDraft((current) => renameComponents(current, grading));
  };

  const addItem = () => {
    const item = newDraftItem();
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    openSection('items');
    setEditingKey(item.key);
  };

  const closeItem = () => {
    const key = editingKey;
    setEditingKey(null);
    // A new item closed without a title was never really added.
    if (key && draft.items.some((item) => item.key === key && !item.title.trim())) {
      setDraft((current) => ({ ...current, items: current.items.filter((item) => item.key !== key) }));
    }
  };

  const removeTextbook = (key: string) => {
    const title = draft.textbooks.find((book) => book.key === key)?.title;
    setDraft((current) => ({
      ...current,
      textbooks: current.textbooks.filter((book) => book.key !== key),
      items: current.items.map((item) =>
        item.reading && title && item.reading.textbook_title === title ? { ...item, reading: { ...item.reading, textbook_title: null } } : item,
      ),
    }));
  };

  // ---- import --------------------------------------------------------------------------------

  const runImport = () => {
    importer.mutate(
      { upload, draft: fromDraft(draft), termChoice: toTermChoice(term, draft.course) },
      {
        onSuccess: ({ plan, replanError }) => {
          // Everything is saved: leaving now must not write the draft back over the import.
          latest.current = { draft, dirty: false };
          setDirty(false);
          toast.show({
            tone: replanError ? 'warning' : 'success',
            title: merging ? 'Syllabus added to your course' : 'Course added',
            message: replanError ? `Everything is saved. Your plan will catch up shortly (${replanError.message}).` : importSummary(plan.summary),
          });
          onImported(plan.courseId);
        },
      },
    );
  };

  const submit = () => {
    setSubmitted(true);
    if (problems.length > 0 || (!merging && !draft.course.title.trim())) return;
    if (draft.grading.length > 0 && Math.abs(total - 100) > 0.5) {
      Alert.alert(`Weights add up to ${total}%`, 'Grade math may be off until they add up to 100%. You can fix them later in the course.', [
        { text: 'Fix weights', style: 'cancel', onPress: () => openSection('grading') },
        { text: 'Add anyway', onPress: runImport },
      ]);
      return;
    }
    runImport();
  };

  const discard = () =>
    confirmDiscardUpload('syllabus', () => {
      latest.current = { draft, dirty: false };
      setDirty(false);
      onDiscard();
    });

  const importLabel = merging ? `Add to ${targetCourse?.code ?? targetCourse?.title ?? 'the course'}` : 'Add to my plan';
  const scaleSummary =
    draft.scale.length > 0
      ? draft.scale
          .slice(0, 4)
          .map((row) => `${row.letter} ${row.min ?? '?'}`)
          .join(' · ') + (draft.scale.length > 4 ? ' …' : '')
      : 'Standard A–F scale';
  const policyCount = [draft.policies.late_policy, draft.policies.attendance_policy, draft.policies.drop_policy, draft.policies.extra_credit].filter(
    (value) => value !== null && value.trim().length > 0,
  ).length;

  return (
    <Screen
      eyebrow={merging ? 'Check what we found' : 'Step 2 of 2 · Check what we found'}
      title={draft.course.code?.trim() || 'Review'}
      subtitle="Fix anything that looks off. Nothing goes in your plan until you add it."
      edges={['bottom']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <NBText variant="smallBold" align="center" color="muted">
            {`${plural(draft.items.length, 'item')}${undated > 0 ? ` · ${undated} without a date` : ''} · ${plural(draft.events.length, 'break')}`}
          </NBText>
          <Button
            label={importLabel}
            size="lg"
            fullWidth
            loading={importer.isPending}
            onPress={submit}
            accessibilityHint="Saves the course, its deadlines and readings, and builds your plan"
          />
        </View>
      }
    >
      <View style={{ gap: spacing.lg }}>
        <WarningsCard
          warnings={draft.warnings}
          items={draft.items}
          onOpenItem={(key) => {
            openSection('items');
            setEditingKey(key);
          }}
          onOpenGrading={() => openSection('grading')}
          onDismiss={(key) => setDraft((current) => ({ ...current, warnings: current.warnings.filter((warning) => warning.key !== key) }))}
        />
        <CourseInfoEditor
          course={draft.course}
          onChange={(course) => setDraft((current) => ({ ...current, course }))}
          titleError={titleError}
          termControl={
            merging ? (
              <NBText variant="small" color="muted">
                {`Adding to ${targetCourse ? (targetCourse.code ?? targetCourse.title) : 'your course'}. We only fill in what's missing — nothing you've changed is overwritten.`}
              </NBText>
            ) : (
              <TermPicker
                terms={terms.data ?? []}
                value={term}
                onChange={setTermPick}
                suggestedName={draft.course.term_name}
              />
            )
          }
        />
        {problems.length > 0 && submitted ? <ErrorBanner title="A few things to fix first" message={problems.join('\n')} /> : null}
        {importer.error ? (
          <ErrorBanner title="Couldn't add the course" message={errorMessage(importer.error)} onRetry={submit} />
        ) : null}
      </View>

      <ReviewSection
        title="Deadlines & readings"
        summary={`${plural(draft.items.length, 'item')}${undated > 0 ? ` · ${undated} need a date` : ''}`}
        open={open.items}
        onOpenChange={(value) => openSection('items', value)}
        action={<Button label="Add" size="sm" variant="secondary" icon={{ name: 'plus', fallback: '+' }} onPress={addItem} accessibilityLabel="Add an item" />}
      >
        <DraftItemList items={draft.items} courseStart={draft.course.start_date} onOpen={setEditingKey} />
      </ReviewSection>

      <ReviewSection
        title="Grading"
        summary={draft.grading.length > 0 ? `${plural(draft.grading.length, 'category', 'categories')} · adds up to ${total}%` : 'None found — add the weights by hand'}
        open={open.grading}
        onOpenChange={(value) => openSection('grading', value)}
      >
        <GradingEditor rows={draft.grading} onChange={setGrading} />
      </ReviewSection>

      <ReviewSection title="Grade scale" summary={scaleSummary} open={open.scale} onOpenChange={(value) => openSection('scale', value)}>
        <GradeScaleEditor rows={draft.scale} onChange={(scale) => setDraft((current) => ({ ...current, scale }))} />
      </ReviewSection>

      <ReviewSection
        title="Breaks & key dates"
        summary={draft.events.length > 0 ? plural(draft.events.length, 'date') : 'None found'}
        open={open.events}
        onOpenChange={(value) => openSection('events', value)}
      >
        <TermEventsEditor
          events={draft.events}
          defaultDate={draft.course.start_date ?? today}
          onChange={(events) => setDraft((current) => ({ ...current, events }))}
        />
      </ReviewSection>

      <ReviewSection
        title="Textbooks"
        summary={draft.textbooks.length > 0 ? plural(draft.textbooks.length, 'book') : 'None found'}
        open={open.textbooks}
        onOpenChange={(value) => openSection('textbooks', value)}
      >
        <DraftTextbooksEditor
          textbooks={draft.textbooks}
          readingCount={(title) => draft.items.filter((item) => item.reading?.textbook_title === title).length}
          onRename={(key, title) => setDraft((current) => renameTextbook(current, key, title))}
          onChange={(book) => setDraft((current) => ({ ...current, textbooks: current.textbooks.map((b) => (b.key === book.key ? book : b)) }))}
          onRemove={removeTextbook}
          onAdd={() => setDraft((current) => ({ ...current, textbooks: [...current.textbooks, newDraftTextbook()] }))}
        />
      </ReviewSection>

      <ReviewSection
        title="Policies"
        summary={[draft.policies.unannounced_quizzes ? 'Pop quizzes possible' : null, policyCount > 0 ? plural(policyCount, 'policy', 'policies') : null]
          .filter(Boolean)
          .join(' · ') || 'Nothing noted'}
        open={open.policies}
        onOpenChange={(value) => openSection('policies', value)}
      >
        <PoliciesFields value={draft.policies} onChange={(policies) => setDraft((current) => ({ ...current, policies }))} />
      </ReviewSection>

      <View style={{ marginTop: spacing.xxl }}>
        <Button label="Discard this syllabus" variant="ghost" fullWidth loading={discarding} onPress={discard} />
      </View>

      <DraftItemSheet
        item={editingItem}
        componentNames={componentNames}
        textbookTitles={textbookTitles}
        onChange={(item) => setDraft((current) => ({ ...current, items: current.items.map((i) => (i.key === item.key ? item : i)) }))}
        onDelete={(key) => {
          setEditingKey(null);
          setDraft((current) => ({ ...current, items: current.items.filter((item) => item.key !== key) }));
        }}
        onClose={closeItem}
      />
    </Screen>
  );
}
