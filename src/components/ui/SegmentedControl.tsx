import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group for VoiceOver, e.g. "Appearance". */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const { colors, borders, radius } = theme;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.row,
        {
          borderWidth: borders.standard,
          borderColor: colors.border,
          borderRadius: radius.control,
          backgroundColor: colors.surface,
        },
        theme.shadow('sm'),
        style,
      ]}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <InkProvider key={option.value} value={inkForFill(selected ? 'ink' : 'surface', colors)}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (selected) return;
                haptic('selection');
                onChange(option.value);
              }}
              style={[
                styles.segment,
                {
                  backgroundColor: selected ? colors.ink : 'transparent',
                  borderLeftWidth: index === 0 ? 0 : borders.hairline,
                  borderLeftColor: colors.border,
                },
              ]}
            >
              <NBText variant="smallBold" dense numberOfLines={1}>
                {option.label}
              </NBText>
            </Pressable>
          </InkProvider>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', overflow: 'hidden', alignSelf: 'stretch' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
