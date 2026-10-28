import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  courseFormFrom,
  hasErrors,
  newCourseForm,
  toSaveCourseInput,
  validateCourseForm,
  weightsOff,
  type CourseForm,
} from '@/components/courses/courseForm';
import { FieldCell, FieldRow, MeetingFields, NumberField } from '@/components/courses/fields';
import { GradeScaleEditor } from '@/components/courses/GradeScaleEditor';
import { GradingEditor, gradingTotal } from '@/components/courses/GradingEditor';
import { param, routes } from '@/components/courses/nav';
import { ColorPicker, TermPicker } from '@/components/courses/pickers';
import { PoliciesFields } from '@/components/courses/PoliciesFields';
import { Button, Card, DateField, EmptyState, ErrorBanner, LoadingBlock, NBText, Screen, SectionHeader, TextField, useToast } from '@/components/ui';
import { useComponents, useCourse, useCourses, useTerms } from '@/data';
import { useSaveCourse } from '@/data/capture';
import { errorMessage } from '@/lib/functions';
import { nextCourseColor, useTheme } from '@/theme';

export default function CourseEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = param(params.id);
  const { spacing } = useTheme();
  const toast = useToast();
  const course = useCourse(id);
  const components = useComponents(id);
  const courses = useCourses({ includeArchived: true });
  const terms = useTerms();
  const save = useSaveCourse();
  const [form, setForm] = useState<CourseForm | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Build the form once its rows are in (editing), or as soon as the color can be picked (new).
  const ready = id ? course.data != null && components.data !== undefined : courses.data !== undefined && terms.data !== undefined;
  if (form === null && ready) {
    if (id && course.data) setForm(courseFormFrom(course.data, components.data ?? []));
    else if (!id) setForm(newCourseForm(nextCourseColor(courses.data?.length ?? 0), terms.data?.find((t) => t.is_active)?.id ?? null));
  }

  const title = id ? 'Edit course' : 'New course';
  const cancel = (
    <Stack.Screen
      options={{
        title,
        gestureEnabled: !save.isPending,
        headerLeft: () => <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} disabled={save.isPending} />,
      }}
    />
  );

  const loadError = (id ? (course.error ?? components.error) : (courses.error ?? terms.error)) ?? null;
  if (loadError && !form) {
    return (
      <Screen edges={['bottom']}>
        {cancel}
        <ErrorBanner
          title="Couldn't load the course"
          message={errorMessage(loadError)}
          onRetry={() => void Promise.all([course.refetch(), components.refetch(), courses.refetch(), terms.refetch()])}
        />
      </Screen>
    );
  }
  if (id && course.data === null) {
    return (
      <Screen edges={['bottom']}>
        {cancel}
        <EmptyState tone="yellow" title="Course not found" message="It may have been deleted." actionLabel="Close" onAction={() => router.back()} />
      </Screen>
    );
  }
  if (!form) {
    return (
      <Screen edges={['bottom']}>
        {cancel}
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading the course" lines={3} />
          <LoadingBlock label="Loading the course" lines={4} />
        </View>
      </Screen>
    );
  }

  const set = (patch: Partial<CourseForm>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const errors = validateCourseForm(form);
  const shown = submitted ? errors : { title: null, endDate: errors.endDate, meetingEnd: null, term: null, grading: null };

  const runSave = () => {
    save.mutate(toSaveCourseInput(form, id), {
      onSuccess: (saved) => {
        toast.show({ tone: 'success', title: id ? 'Course saved' : 'Course added', message: 'Your plan is updating.' });
        if (id) router.back();
        else router.replace(routes.course(saved.id));
      },
    });
  };

  const submit = () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    if (weightsOff(form)) {
      Alert.alert(`Weights add up to ${gradingTotal(form.grading)}%`, 'Grade math may be off until they add up to 100%.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save anyway', onPress: runSave },
      ]);
      return;
    }
    runSave();
  };

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label={id ? 'Save changes' : 'Add course'} size="lg" fullWidth loading={save.isPending} onPress={submit} />}
    >
      {cancel}
      <View style={{ gap: spacing.lg }}>
        {save.error ? <ErrorBanner title="Couldn't save" message={errorMessage(save.error)} onRetry={submit} /> : null}
        {submitted && hasErrors(errors) ? (
          <ErrorBanner tone="warning" title="A few things to fix" message={Object.values(errors).filter(Boolean).join('\n')} />
        ) : null}

        <Card style={{ gap: spacing.md }}>
          <TextField
            label="Course title"
            value={form.title}
            onChangeText={(value) => set({ title: value })}
            placeholder="e.g. Intro to Psychology"
            autoCapitalize="words"
            error={shown.title}
          />
          <FieldRow>
            <FieldCell>
              <TextField label="Code" value={form.code} placeholder="PSY 101" autoCapitalize="characters" onChangeText={(value) => set({ code: value })} />
            </FieldCell>
            <FieldCell>
              <TextField label="Section" value={form.section} placeholder="02" onChangeText={(value) => set({ section: value })} />
            </FieldCell>
          </FieldRow>
          <TextField label="Instructor" value={form.instructor} autoCapitalize="words" onChangeText={(value) => set({ instructor: value })} />
          <TextField
            label="Instructor email"
            value={form.instructorEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => set({ instructorEmail: value })}
          />
          <FieldRow>
            <FieldCell flex={2}>
              <TextField label="Room" value={form.location} onChangeText={(value) => set({ location: value })} />
            </FieldCell>
            <FieldCell>
              <NumberField label="Credits" value={form.credits} min={0} max={20} onChange={(credits) => set({ credits })} />
            </FieldCell>
          </FieldRow>
          <ColorPicker value={form.color} onChange={(color) => set({ color })} />
        </Card>

        <SectionHeader title="Schedule" />
        <Card style={{ gap: spacing.md }}>
          <TermPicker terms={terms.data ?? []} value={form.term} onChange={(term) => set({ term })} />
          {shown.term ? (
            <NBText variant="smallBold" color="muted">
              {`⚠ ${shown.term}`}
            </NBText>
          ) : null}
          <MeetingFields
            days={form.meetingDays}
            start={form.meetingStart}
            end={form.meetingEnd}
            onChange={({ days, start, end }) => set({ meetingDays: days, meetingStart: start, meetingEnd: end })}
          />
          <FieldRow>
            <FieldCell>
              <DateField label="First day" value={form.startDate} onChange={(startDate) => set({ startDate })} placeholder="Pick a date" />
            </FieldCell>
            <FieldCell>
              <DateField
                label="Last day"
                value={form.endDate}
                onChange={(endDate) => set({ endDate })}
                placeholder="Pick a date"
                error={shown.endDate}
              />
            </FieldCell>
          </FieldRow>
        </Card>

        <SectionHeader title="Grading breakdown" />
        <NBText variant="small" color="muted">
          Type the weights straight from the syllabus. They tell Termwise which deadlines matter most.
        </NBText>
        {shown.grading ? <ErrorBanner tone="warning" message={shown.grading} /> : null}
        <GradingEditor rows={form.grading} onChange={(grading) => set({ grading })} />
        <NumberField
          label="Goal grade"
          value={form.targetPercent}
          min={0}
          max={100}
          suffix="%"
          placeholder="Optional"
          helper="Used by “what do I need” on the Grades tab."
          onChange={(targetPercent) => set({ targetPercent })}
        />

        <SectionHeader title="Letter grades" />
        <GradeScaleEditor rows={form.scale} onChange={(scale) => set({ scale })} />

        <SectionHeader title="Policies" />
        <PoliciesFields value={form.policies} onChange={(policies) => set({ policies })} />
      </View>
    </Screen>
  );
}
