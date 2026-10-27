import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type AccentColor } from '@/theme';

import { resolveFill } from './fills';
import { Icon, type SymbolName } from './Icon';
import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';
import { PressableSurface } from './PressableSurface';

export interface ChipProps {
  label: string;
  /** When defined the chip is a toggle (checkbox / radio semantics). */
  selected?: boolean;
  onPress?: () => void;
  /** checkbox for multi-select groups, radio for single-select. */
  role?: 'checkbox' | 'radio' | 'button';
  icon?: { name: SymbolName; fallback: string };
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pill-shaped toggle. Selected = yellow fill + check mark, so state is never color-only. */
export function Chip({ label, selected, onPress, role, icon, disabled, accessibilityLabel, style }: ChipProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const isToggle = selected !== undefined;
  const on = selected === true;
  const a11yRole = role ?? (isToggle ? 'checkbox' : 'button');

  return (
    <InkProvider value={inkForFill(on ? 'accent' : 'surface', colors)}>
      <PressableSurface
        onPress={onPress}
        disabled={disabled}
        shadow={on ? 'none' : 'sm'}
        haptic="selection"
        accessibilityRole={a11yRole}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={isToggle ? (a11yRole === 'checkbox' ? { checked: on } : { selected: on }) : undefined}
        style={[
          styles.chip,
          {
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            borderWidth: borders.hairline,
            borderColor: colors.border,
            backgroundColor: on ? colors.yellow : colors.surface,
          },
          style,
        ]}
      >
        {on ? (
          <Icon name="checkmark" fallback={'✓'} size={14} weight="heavy" />
        ) : icon ? (
          <Icon name={icon.name} fallback={icon.fallback} size={14} />
        ) : null}
        <NBText variant="smallBold" dense numberOfLines={1}>
          {label}
        </NBText>
      </PressableSurface>
    </InkProvider>
  );
}

export interface TagProps {
  label: string;
  /** Accent token or a course hex color. */
  color?: AccentColor | (string & {});
  style?: StyleProp<ViewStyle>;
}

/** Square-cornered label stamp (non-interactive). */
export function Tag({ label, color = 'yellow', style }: TagProps) {
  const { colors, borders, spacing } = useTheme();
  return (
    <InkProvider value={inkForFill('accent', colors)}>
      <View
        style={[
          styles.tag,
          {
            backgroundColor: resolveFill(color, colors),
            borderColor: colors.border,
            borderWidth: borders.hairline,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          },
          style,
        ]}
      >
        <NBText variant="label" dense numberOfLines={1}>
          {label}
        </NBText>
      </View>
    </InkProvider>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  tag: { alignSelf: 'flex-start', borderRadius: 0 },
});
