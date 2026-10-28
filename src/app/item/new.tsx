import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { param, routes } from '@/components/courses/nav';
import { CoursePicker } from '@/components/courses/pickers';
import { ItemForm } from '@/components/items/ItemForm';
import { newItemForm, toNewItem, validateItemForm, type ItemFormValues } from '@/components/items/item-form';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, Screen, useToast } from '@/components/ui';
import { useComponents, useCourses, useCreateItem, useTextbooks } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

export default function NewItemScreen() {
  const params = useLocalSearchParams<{ courseId?: string }>();
  const { spacing } = useTheme();
  const toast = useToast();
  const courses = useCourses();
  const [courseId, setCourseId] = useState<string | null>(param(params.courseId));
  const components = useComponents(courseId);
  const textbooks = useTextbooks(courseId);
  const create = useCreateItem();
  const [values, setValues] = useState<ItemFormValues>(() => newItemForm());
  const [submitted, setSubmitted] = useState(false);

  const errors = validateItemForm(values);
  const shown = submitted ? errors : { title: null, assignedDate: errors.assignedDate };
  const courseList = courses.data ?? [];
  const fixedCourse = param(params.courseId) !== null && courseList.some((course) => course.id === courseId);

  const submit = () => {
    setSubmitted(true);
    if (!courseId || errors.title || errors.assignedDate) return;
    create.mutate(toNewItem(values, courseId), {
      onSuccess: (item) => {
        toast.show({ tone: 'success', title: 'Added', message: `${item.title} is in your plan.` });
        router.back();
      },
    });
  };

  const header = (
    <Stack.Screen
      options={{
        title: 'New item',
        gestureEnabled: !create.isPending,
        headerLeft: () => <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} disabled={create.isPending} />,
      }}
    />
  );

  if (courses.isPending) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <LoadingBlock label="Loading your courses" lines={4} />
      </Screen>
    );
  }
  if (courses.error) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <ErrorBanner title="Couldn't load your courses" message={errorMessage(courses.error)} onRetry={() => void courses.refetch()} />
      </Screen>
    );
  }
  if (courseList.length === 0) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <EmptyState
          tone="pink"
          title="Add a course first"
          message="Items belong to a course. Add the course, then its deadlines."
          actionLabel="Add a course"
          onAction={() => router.replace(routes.courseEdit())}
        />
      </Screen>
    );
  }

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Add to my plan" size="lg" fullWidth loading={create.isPending} onPress={submit} />}
    >
      {header}
      <View style={{ gap: spacing.lg }}>
        {create.error ? <ErrorBanner title="Couldn't add it" message={errorMessage(create.error)} onRetry={submit} /> : null}
        {fixedCourse ? null : (
          <Card shadow="sm">
            <CoursePicker
              courses={courseList}
              value={courseId}
              onChange={(next) => {
                setCourseId(next);
                setValues((current) => ({ ...current, componentId: null, reading: current.reading ? { ...current.reading, textbook_id: null } : null }));
              }}
            />
          </Card>
        )}
        {submitted && !courseId ? <ErrorBanner tone="warning" message="Pick the course this belongs to." /> : null}
        <ItemForm
          values={values}
          onChange={setValues}
          components={components.data ?? []}
          textbooks={textbooks.data ?? []}
          errors={shown}
        />
      </View>
    </Screen>
  );
}
