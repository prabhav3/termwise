import { router } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Card, NBText, Tag } from '@/components/ui';
import { parseLmsStamp, type DiscrepancyAction } from '@/data';
import { formatDayDate } from '@/lib/dates';
import { useTheme, type AccentColor } from '@/theme';
import type { DiscrepancyKind, LmsDiscrepancy, LmsProvider, Timestamp } from '@/types/db';

import { discrepancyColumns, DISCREPANCY_KIND_LABELS, formatLmsValue } from './format';

const KIND_TONES: Record<DiscrepancyKind, AccentColor> = {
  date_mismatch: 'yellow',
  locks_before_due: 'red',
  missing_in_lms: 'blue',
  missing_in_syllabus: 'purple',
  weight_mismatch: 'orange',
  points_mismatch: 'pink',
};

interface ActionSpec {
  action: DiscrepancyAction;
  label: string;
  hint: string;
}

/** The choices that make sense for each kind; the first one is the primary button. */
function actionsFor(discrepancy: LmsDiscrepancy, lmsName: string, provider: LmsProvider | null): ActionSpec[] {
  const hasLmsDate = parseLmsStamp(discrepancy.lms_value) !== null;
  const keep: ActionSpec = { action: 'keep_syllabus', label: 'Keep syllabus', hint: 'Marks this as resolved without changes' };
  switch (discrepancy.kind) {
    case 'date_mismatch':
      return discrepancy.item_id && hasLmsDate
        ? [{ action: 'use_lms', label: `Use ${lmsName} date`, hint: `Moves the due date to the ${lmsName} date and replans` }, keep]
        : [keep];
    case 'locks_before_due':
      return discrepancy.item_id && hasLmsDate
        ? [
            {
              action: 'use_lms',
              label: 'Due when it locks',
              hint: `Moves the deadline to when ${lmsName} stops accepting work, and replans`,
            },
            keep,
          ]
        : [keep];
    case 'missing_in_syllabus':
      return provider === 'canvas'
        ? [{ action: 'keep_syllabus', label: 'Got it', hint: 'Canvas assignments are already in your plan' }]
        : [{ action: 'add_item', label: 'Add to my plan', hint: 'Creates an item with the LMS date and replans' }];
    case 'missing_in_lms':
      return [{ action: 'keep_syllabus', label: 'Got it', hint: 'Keeps the syllabus item as it is' }];
    default:
      return [keep];
  }
}

function ValueColumn({ label, value, emphasis, fill }: { label: string; value: string; emphasis: boolean; fill: boolean }) {
  const { colors, spacing, borders, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        fill ? styles.column : null,
        {
          gap: spacing.xs,
          padding: spacing.md,
          backgroundColor: emphasis ? colors.surfaceAlt : colors.surface,
          borderColor: colors.border,
          borderWidth: borders.hairline,
          borderRadius: radius.control,
        },
      ]}
    >
      <NBText variant="label" color="muted" dense>
        {label}
      </NBText>
      <NBText variant="bodyBold" dense>
        {value}
      </NBText>
    </View>
  );
}

function resolvedLabel(status: LmsDiscrepancy['status'], at: Timestamp | null): string {
  const word = status === 'dismissed' ? 'Dismissed' : 'Resolved';
  if (!at) return word;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return word;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${word} ${formatDayDate(iso)}`;
}

export interface DiscrepancyCardProps {
  discrepancy: LmsDiscrepancy;
  lmsName: string;
  provider: LmsProvider | null;
  busyAction: DiscrepancyAction | null;
  onAct: (action: DiscrepancyAction) => void;
}

export function DiscrepancyCard({ discrepancy, lmsName, provider, busyAction, onAct }: DiscrepancyCardProps) {
  const { spacing } = useTheme();
  // Large Dynamic Type: stack the two values instead of squeezing them side by side.
  const stacked = useWindowDimensions().fontScale > 1.35;
  const columns = discrepancyColumns(discrepancy.kind, lmsName);
  const isOpen = discrepancy.status === 'open';
  const actions = actionsFor(discrepancy, lmsName, provider);
  const busy = busyAction !== null;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Tag label={DISCREPANCY_KIND_LABELS[discrepancy.kind]} color={KIND_TONES[discrepancy.kind]} />
        <NBText variant="h3">{discrepancy.title}</NBText>
      </View>

      <View style={[styles.columns, { gap: spacing.sm, flexDirection: stacked ? 'column' : 'row' }]}>
        <ValueColumn label={columns.syllabus} value={formatLmsValue(discrepancy.syllabus_value)} emphasis={false} fill={!stacked} />
        <ValueColumn label={columns.lms} value={formatLmsValue(discrepancy.lms_value)} emphasis fill={!stacked} />
      </View>

      {discrepancy.detail ? (
        <NBText variant="small" color="muted">
          {discrepancy.detail}
        </NBText>
      ) : null}

      {isOpen ? (
        <View style={{ gap: spacing.sm }}>
          <View style={[styles.wrap, { gap: spacing.sm }]}>
            {actions.map((spec, index) => (
              <Button
                key={spec.action}
                label={spec.label}
                variant={index === 0 ? 'primary' : 'secondary'}
                size="sm"
                loading={busyAction === spec.action}
                disabled={busy && busyAction !== spec.action}
                accessibilityHint={spec.hint}
                onPress={() => onAct(spec.action)}
              />
            ))}
            <Button
              label="Dismiss"
              variant="ghost"
              size="sm"
              loading={busyAction === 'dismiss'}
              disabled={busy && busyAction !== 'dismiss'}
              accessibilityHint="Hides it without changing anything"
              onPress={() => onAct('dismiss')}
            />
          </View>
          {discrepancy.item_id ? (
            <Button
              label="Open item"
              variant="ghost"
              size="sm"
              onPress={() => router.push(`/item/${discrepancy.item_id}`)}
            />
          ) : discrepancy.kind === 'weight_mismatch' ? (
            <Button
              label="Edit grade weights"
              variant="ghost"
              size="sm"
              onPress={() => router.push(`/course/${discrepancy.course_id}`)}
            />
          ) : null}
        </View>
      ) : (
        <View style={[styles.wrap, { gap: spacing.sm, alignItems: 'center' }]}>
          <NBText variant="smallBold" color="muted" style={styles.flex}>
            {`✓ ${resolvedLabel(discrepancy.status, discrepancy.resolved_at)}`}
          </NBText>
          <Button
            label="Reopen"
            variant="secondary"
            size="sm"
            loading={busyAction === 'reopen'}
            onPress={() => onAct('reopen')}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  columns: { alignItems: 'stretch' },
  column: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
