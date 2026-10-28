import * as Linking from 'expo-linking';
import { getCalendars } from 'expo-localization';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  ErrorBanner,
  ListRow,
  NBText,
  ProgressBar,
  Screen,
  Stepper,
  TimeField,
  Toggle,
} from '@/components/ui';
import { useUpdateProfile } from '@/data/profile';
import { useAuth } from '@/lib/auth';
import { deviceTimeZone, formatMinutes, formatTimeOfDay, normalizeTime, WEEKDAY_LONG, WEEKDAY_SHORT } from '@/lib/dates';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/lib/notifications';
import { useTheme } from '@/theme';

const STEPS = ['days', 'capacity', 'reading', 'morning'] as const;
type Step = (typeof STEPS)[number];

/** Monday-first, the way students think about a school week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAYS = [1, 2, 3, 4, 5];

const READING_PRESETS = [
  { label: 'Light · 30', value: 30, hint: 'novels, articles' },
  { label: 'Textbook · 20', value: 20, hint: 'most course reading' },
  { label: 'Dense · 12', value: 12, hint: 'technical, primary sources' },
] as const;

const EXAMPLE_PAGES = 60;

function studentTimeZone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? deviceTimeZone();
  } catch {
    return deviceTimeZone();
  }
}

export default function OnboardingScreen() {
  const { profile } = useAuth();
  const { spacing } = useTheme();
  const updateProfile = useUpdateProfile();

  const [step, setStep] = useState<Step>('days');
  const [studyDays, setStudyDays] = useState<number[]>(() => profile?.study_days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [capacity, setCapacity] = useState(() => profile?.daily_capacity_minutes ?? 180);
  const [pagesPerHour, setPagesPerHour] = useState(() => profile?.reading_pages_per_hour ?? 20);
  const [triageTime, setTriageTime] = useState(() => normalizeTime(profile?.triage_notification_time ?? '07:30'));
  const [remindersOn, setRemindersOn] = useState(() => profile?.notifications_enabled ?? true);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getNotificationPermission().then((current) => {
      if (active) setPermission(current);
    });
    return () => {
      active = false;
    };
  }, []);

  const index = STEPS.indexOf(step);
  const isLast = index === STEPS.length - 1;

  const toggleDay = (day: number) => {
    setDaysError(null);
    setStudyDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  };

  const askForNotifications = async () => {
    const answer = await requestNotificationPermission();
    setPermission(answer);
    setRemindersOn(answer === 'granted');
    haptic(answer === 'granted' ? 'success' : 'warning');
  };

  const finish = () => {
    updateProfile.mutate(
      {
        study_days: [...studyDays].sort((a, b) => a - b),
        daily_capacity_minutes: capacity,
        reading_pages_per_hour: pagesPerHour,
        triage_notification_time: triageTime,
        notifications_enabled: remindersOn && permission === 'granted',
        timezone: studentTimeZone(),
        onboarded_at: new Date().toISOString(),
      },
      {
        // The root guard opens the app as soon as onboarded_at lands in the cache.
        onSuccess: () => haptic('success'),
        onError: () => haptic('error'),
      },
    );
  };

  const next = () => {
    if (step === 'days' && studyDays.length === 0) {
      setDaysError('Pick at least one day — even one short session a week counts.');
      haptic('warning');
      return;
    }
    if (isLast) finish();
    else setStep(STEPS[index + 1]);
  };

  const back = () => {
    if (index > 0) setStep(STEPS[index - 1]);
  };

  const footer = (
    <View style={{ gap: spacing.md }}>
      {updateProfile.error ? (
        <ErrorBanner title="Couldn't save your setup" message={errorMessage(updateProfile.error)} />
      ) : null}
      <View style={[styles.row, { gap: spacing.md }]}>
        {index > 0 ? (
          <Button label="Back" variant="secondary" size="lg" onPress={back} disabled={updateProfile.isPending} />
        ) : null}
        <Button
          label={isLast ? 'Build my plan' : 'Next'}
          size="lg"
          style={styles.flex}
          fullWidth
          loading={updateProfile.isPending}
          onPress={next}
        />
      </View>
    </View>
  );

  return (
    <Screen footer={footer}>
      <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <NBText variant="label" color="muted">{`Step ${index + 1} of ${STEPS.length}`}</NBText>
        <ProgressBar value={(index + 1) / STEPS.length} label="Setup progress" color="primary" height={14} />
      </View>

      {step === 'days' ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="display">When can you study?</NBText>
          <NBText variant="body" color="muted">
            Termwise only plans work on these days. You can block out specific dates later.
          </NBText>
          <View style={[styles.wrap, { gap: spacing.sm }]}>
            {WEEK_ORDER.map((day) => (
              <Chip
                key={day}
                label={WEEKDAY_SHORT[day]}
                accessibilityLabel={WEEKDAY_LONG[day]}
                selected={studyDays.includes(day)}
                onPress={() => toggleDay(day)}
              />
            ))}
          </View>
          {daysError ? (
            <NBText variant="smallBold" color="danger" accessibilityRole="alert">
              {`⚠ ${daysError}`}
            </NBText>
          ) : null}
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Button label="Weekdays" variant="secondary" size="sm" onPress={() => setStudyDays(WEEKDAYS)} />
            <Button label="Every day" variant="secondary" size="sm" onPress={() => setStudyDays([0, 1, 2, 3, 4, 5, 6])} />
          </View>
        </View>
      ) : null}

      {step === 'capacity' ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="display">How much time a day?</NBText>
          <NBText variant="body" color="muted">
            Focused study time on a normal study day — not counting class. Be honest; a plan you can keep beats an
            ambitious one.
          </NBText>
          <Stepper
            label="Daily study time"
            value={capacity}
            onChange={setCapacity}
            min={30}
            max={600}
            step={15}
            format={formatMinutes}
            unit="per study day"
          />
          <Card color="surfaceAlt" shadow="none">
            <NBText variant="bodyMedium">
              {`That's about ${formatMinutes(capacity * studyDays.length)} a week across ${studyDays.length} ${
                studyDays.length === 1 ? 'day' : 'days'
              }.`}
            </NBText>
          </Card>
        </View>
      ) : null}

      {step === 'reading' ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="display">How fast do you read?</NBText>
          <NBText variant="body" color="muted">
            Pages per hour of course reading, taking notes as you go.
          </NBText>
          <Stepper
            label="Reading speed"
            value={pagesPerHour}
            onChange={setPagesPerHour}
            min={5}
            max={80}
            step={1}
            unit="pages per hour"
          />
          <View style={[styles.wrap, { gap: spacing.sm }]}>
            {READING_PRESETS.map((preset) => (
              <Chip
                key={preset.value}
                role="radio"
                label={preset.label}
                accessibilityLabel={`${preset.value} pages per hour, ${preset.hint}`}
                selected={pagesPerHour === preset.value}
                onPress={() => setPagesPerHour(preset.value)}
              />
            ))}
          </View>
          <Card color="yellow" style={{ gap: spacing.sm }}>
            <NBText variant="h3">Why pages per hour?</NBText>
            <NBText variant="body">
              {`Syllabi say things like "Read ch. 4–6". Termwise turns chapters into pages, then pages into time: at ${pagesPerHour} pages an hour, ${EXAMPLE_PAGES} pages is about ${formatMinutes(
                Math.ceil((EXAMPLE_PAGES / pagesPerHour) * 60),
              )}, spread over the days before class.`}
            </NBText>
            <NBText variant="small" color="muted">
              Not sure? 20 is a good start — you can change it any time in Settings.
            </NBText>
          </Card>
        </View>
      ) : null}

      {step === 'morning' ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="display">Your morning top 3.</NBText>
          <NBText variant="body" color="muted">
            {"Each morning we'll send the three things that matter most today. Nothing else, no nagging."}
          </NBText>
          <TimeField label="Send it at" value={triageTime} onChange={setTriageTime} />

          {permission === 'granted' ? (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              <ListRow
                title="Morning reminders"
                subtitle={remindersOn ? `Every day at ${formatTimeOfDay(triageTime)}` : 'Off'}
                right={
                  <Toggle value={remindersOn} onValueChange={setRemindersOn} accessibilityLabel="Morning reminders" />
                }
              />
            </Card>
          ) : permission === 'denied' ? (
            <Card color="orange" style={{ gap: spacing.md }}>
              <NBText variant="bodyBold">Notifications are off for Termwise.</NBText>
              <NBText variant="small">
                Turn them on in iOS Settings to get your morning top 3. Your plan works either way.
              </NBText>
              <Button
                label="Open Settings"
                variant="secondary"
                size="sm"
                onPress={() => void Linking.openSettings()}
              />
            </Card>
          ) : (
            <Card style={{ gap: spacing.md }}>
              <NBText variant="bodyBold">Allow notifications?</NBText>
              <NBText variant="small" color="muted">
                {"We'll only ever send the morning plan. You can turn it off any time."}
              </NBText>
              <Button
                label="Turn on morning reminders"
                icon={{ name: 'bell.fill', fallback: '♪' }}
                fullWidth
                onPress={() => void askForNotifications()}
              />
            </Card>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
