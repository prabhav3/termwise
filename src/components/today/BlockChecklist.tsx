import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BLOCK_KIND_ICON, BLOCK_KIND_LABEL, BLOCK_STATUS_LABEL, courseName } from '@/components/plan/labels';
import { Button, Card, CourseTag, Icon, NBText, Sheet } from '@/components/ui';
import type { BlockStatus, EngineBlock, EngineCourse } from '@/engine';
import { formatMinutes } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

export type PendingAction = 'done' | 'missed';

const SHEET_DISMISS_MS = 300;

export interface BlockChecklistProps {
  blocks: readonly EngineBlock[];
  courses: Map<string, EngineCourse>;
  /** Optimistic statuses while a request is in flight. */
  pending: ReadonlyMap<string, PendingAction>;
  onDone: (block: EngineBlock) => void;
  onMissed: (block: EngineBlock) => void;
  onFocus: (block: EngineBlock) => void;
  onOpenItem: (block: EngineBlock) => void;
}

function effectiveStatus(block: EngineBlock, pending: ReadonlyMap<string, PendingAction>): BlockStatus {
  return pending.get(block.key) ?? block.status;
}

interface RowProps {
  block: EngineBlock;
  status: BlockStatus;
  busy: boolean;
  course: EngineCourse | undefined;
  divider: boolean;
  onCheck: () => void;
  onMore: () => void;
}

function ChecklistRow({ block, status, busy, course, divider, onCheck, onMore }: RowProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const planned = status === 'planned';
  const checked = status === 'done';
  const icon = BLOCK_KIND_ICON[block.kind];
  const meta = `${BLOCK_KIND_LABEL[block.kind]} · ${formatMinutes(block.minutes)}${planned ? '' : ` · ${BLOCK_STATUS_LABEL[status]}`}`;

  return (
    <View
      style={[
        styles.row,
        {
          gap: spacing.md,
          paddingVertical: spacing.sm,
          borderTopWidth: divider ? borders.hairline : 0,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Done: ${block.label}`}
        accessibilityHint={planned ? 'Checks this block off and updates your plan' : undefined}
        accessibilityState={{ checked, disabled: !planned || busy, busy }}
        disabled={!planned || busy}
        hitSlop={4}
        onPress={() => {
          haptic('light');
          onCheck();
        }}
        style={({ pressed }) => [
          styles.check,
          {
            borderWidth: borders.standard,
            borderColor: colors.border,
            borderRadius: radius.control,
            backgroundColor: checked ? colors.green : status === 'missed' ? colors.surfaceAlt : colors.surface,
            transform: pressed ? [{ translateX: 2 }, { translateY: 2 }] : [],
          },
        ]}
      >
        {checked ? <Icon name="checkmark" fallback="✓" size={22} weight="heavy" color={colors.onAccent} /> : null}
        {status === 'missed' ? <Icon name="arrow.uturn.forward" fallback="↷" size={18} color={colors.inkMuted} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${block.label}. ${courseName(course)}. ${meta}`}
        accessibilityHint="Shows options: focus, done, couldn't get to it"
        onPress={() => {
          haptic('selection');
          onMore();
        }}
        style={({ pressed }) => [styles.body, { gap: spacing.sm, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.grow, { gap: 2 }]}>
          <NBText
            variant="bodyBold"
            color={planned ? undefined : 'muted'}
            style={planned ? null : styles.struck}
            numberOfLines={3}
          >
            {block.label}
          </NBText>
          <View style={[styles.meta, { gap: spacing.sm }]}>
            {course ? <CourseTag course={course} /> : null}
            <Icon name={icon.name} fallback={icon.fallback} size={12} color={colors.inkMuted} />
            <NBText variant="tiny" color="muted" dense>
              {meta}
            </NBText>
          </View>
        </View>
        <Icon name="ellipsis" fallback="…" size={18} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

/** Today's blocks as a checklist. Tapping a block opens focus / done / missed options. */
export function BlockChecklist({ blocks, courses, pending, onDone, onMissed, onFocus, onOpenItem }: BlockChecklistProps) {
  const { spacing } = useTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = blocks.find((block) => block.key === selectedKey) ?? null;
  const selectedStatus = selected ? effectiveStatus(selected, pending) : null;
  const selectedCourse = selected ? courses.get(selected.course_id) : undefined;
  const close = () => setSelectedKey(null);
  /** Navigation waits for the sheet's modal to finish dismissing (iOS can't present two at once). */
  const navigateAfterClose = (navigate: () => void) => {
    close();
    setTimeout(navigate, SHEET_DISMISS_MS);
  };

  return (
    <>
      <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
        {blocks.map((block, index) => (
          <ChecklistRow
            key={block.key}
            block={block}
            status={effectiveStatus(block, pending)}
            busy={pending.has(block.key)}
            course={courses.get(block.course_id)}
            divider={index > 0}
            onCheck={() => onDone(block)}
            onMore={() => setSelectedKey(block.key)}
          />
        ))}
      </Card>
      <Sheet visible={selected !== null} onClose={close} title={selected?.label}>
        {selected ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.meta, { gap: spacing.sm }]}>
              {selectedCourse ? <CourseTag course={selectedCourse} /> : null}
              <NBText variant="small" color="muted">
                {`${BLOCK_KIND_LABEL[selected.kind]} · ${formatMinutes(selected.minutes)} · ${BLOCK_STATUS_LABEL[selectedStatus ?? selected.status]}`}
              </NBText>
            </View>
            {selectedStatus === 'planned' ? (
              <>
                <Button
                  label="Start focus"
                  icon={{ name: 'timer', fallback: '◷' }}
                  fullWidth
                  onPress={() => navigateAfterClose(() => onFocus(selected))}
                />
                <Button
                  label="Mark done"
                  variant="secondary"
                  icon={{ name: 'checkmark', fallback: '✓' }}
                  fullWidth
                  onPress={() => {
                    close();
                    onDone(selected);
                  }}
                />
                <Button
                  label="Couldn't get to it"
                  variant="secondary"
                  icon={{ name: 'arrow.uturn.forward', fallback: '↷' }}
                  accessibilityHint="Moves this work to your next study days before the deadline"
                  fullWidth
                  onPress={() => {
                    close();
                    onMissed(selected);
                  }}
                />
                <NBText variant="tiny" color="muted">
                  Couldn&apos;t get to it? No stress — Termwise spreads the work over the study days left before the deadline.
                </NBText>
              </>
            ) : null}
            <Button
              label="Open assignment"
              variant="ghost"
              fullWidth
              onPress={() => navigateAfterClose(() => onOpenItem(selected))}
            />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  check: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  grow: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
});
