import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Chip, NBText, Stepper } from '@/components/ui';
import { formatMinutes, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';

import { BlackoutDates } from './BlackoutDates';
import { StudyDaysPicker } from './StudyDaysPicker';
import type { ProfileAutosave } from './useProfileAutosave';

const READING_PRESETS = [
  { label: 'Light · 30', value: 30, hint: 'novels, articles' },
  { label: 'Textbook · 20', value: 20, hint: 'most course reading' },
  { label: 'Dense · 12', value: 12, hint: 'technical, primary sources' },
] as const;

/** A titled setting: what it is, one line on what it changes, then the control. */
export function SettingBlock({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: spacing.xs }}>
        <NBText variant="bodyBold">{title}</NBText>
        {helper ? (
          <NBText variant="small" color="muted">
            {helper}
          </NBText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Everything the planner paces with: when, how much, how fast, what counts as big. */
export function StudyPreferences({ settings, today }: { settings: ProfileAutosave; today: ISODate }) {
  const { spacing } = useTheme();
  const studyDays = settings.value('study_days');
  const capacity = settings.value('daily_capacity_minutes');
  const pagesPerHour = settings.value('reading_pages_per_hour');
  const pagesPerChapter = settings.value('default_pages_per_chapter');
  const threshold = Number(settings.value('high_impact_threshold'));

  return (
    <View style={{ gap: spacing.lg }}>
      <Card style={{ gap: spacing.xl }}>
        <SettingBlock title="Study days" helper="Termwise only plans work on these days.">
          <StudyDaysPicker value={studyDays} onChange={(days) => settings.set('study_days', days)} />
        </SettingBlock>

        <SettingBlock
          title="Daily study time"
          helper={`Focused time on a study day, not counting class. About ${formatMinutes(
            capacity * studyDays.length,
          )} a week.`}
        >
          <Stepper
            label="Daily study time"
            value={capacity}
            onChange={(next) => settings.set('daily_capacity_minutes', next)}
            min={15}
            max={720}
            step={15}
            format={formatMinutes}
            unit="per study day"
          />
        </SettingBlock>
      </Card>

      <Card style={{ gap: spacing.xl }}>
        <SettingBlock title="Reading speed" helper="Pages per hour of course reading, taking notes as you go.">
          <Stepper
            label="Reading speed"
            value={pagesPerHour}
            onChange={(next) => settings.set('reading_pages_per_hour', next)}
            min={5}
            max={120}
            unit="pages per hour"
          />
          <View accessibilityRole="radiogroup" accessibilityLabel="Reading speed presets" style={[styles.wrap, { gap: spacing.sm }]}>
            {READING_PRESETS.map((preset) => (
              <Chip
                key={preset.value}
                role="radio"
                label={preset.label}
                accessibilityLabel={`${preset.value} pages per hour, ${preset.hint}`}
                selected={pagesPerHour === preset.value}
                onPress={() => settings.set('reading_pages_per_hour', preset.value)}
              />
            ))}
          </View>
        </SettingBlock>

        <SettingBlock
          title="Pages per chapter"
          helper="Used when a syllabus says “Read ch. 4” and that book’s page numbers aren’t mapped yet."
        >
          <Stepper
            label="Default pages per chapter"
            value={pagesPerChapter}
            onChange={(next) => settings.set('default_pages_per_chapter', next)}
            min={5}
            max={200}
            step={5}
            unit="pages"
          />
        </SettingBlock>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SettingBlock
          title="High-impact work"
          helper={`Anything worth at least ${threshold}% of a course grade starts earlier and gets more study time.`}
        >
          <Stepper
            label="High-impact threshold"
            value={threshold}
            onChange={(next) => settings.set('high_impact_threshold', next)}
            min={5}
            max={50}
            step={5}
            format={(value) => `${value}%`}
            unit="of the course grade"
          />
        </SettingBlock>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SettingBlock title="Days off" helper="Trips, shifts, holidays. Termwise plans no work on them and fits it in around them.">
          <BlackoutDates
            value={settings.value('blackout_dates')}
            today={today}
            onChange={(dates) => settings.set('blackout_dates', dates)}
          />
        </SettingBlock>
      </Card>
    </View>
  );
}

/** Pomodoro lengths used by the Focus timer. */
export function FocusTimerSettings({ settings }: { settings: ProfileAutosave }) {
  const { spacing } = useTheme();
  const focus = settings.value('pomodoro_focus_minutes');
  const rest = settings.value('pomodoro_break_minutes');
  return (
    <Card style={{ gap: spacing.xl }}>
      <SettingBlock title="Focus length" helper="One focus round in the Focus timer.">
        <Stepper
          label="Focus length"
          value={focus}
          onChange={(next) => settings.set('pomodoro_focus_minutes', next)}
          min={5}
          max={120}
          step={5}
          format={formatMinutes}
          unit="per round"
        />
      </SettingBlock>
      <SettingBlock title="Break length" helper="The pause between rounds.">
        <Stepper
          label="Break length"
          value={rest}
          onChange={(next) => settings.set('pomodoro_break_minutes', next)}
          min={1}
          max={60}
          format={formatMinutes}
          unit="per break"
        />
      </SettingBlock>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
