import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type SymbolName } from './Icon';
import { InkProvider, inkForFill, type InkColors } from './ink';
import { NBText } from './NBText';
import { PressableSurface } from './PressableSurface';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: { name: SymbolName; fallback: string };
  fullWidth?: boolean;
  accessibilityHint?: string;
  /** Overrides the spoken label (defaults to `label`). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 44, md: 52, lg: 60 };
const PAD_X: Record<ButtonSize, number> = { sm: 14, md: 18, lg: 22 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  accessibilityHint,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const { colors, borders, radius, spacing } = useTheme();

  const fill: Record<ButtonVariant, { bg: string; ink: InkColors; bordered: boolean }> = {
    primary: { bg: colors.primary, ink: inkForFill('primary', colors), bordered: true },
    secondary: { bg: colors.surface, ink: inkForFill('surface', colors), bordered: true },
    danger: { bg: colors.red, ink: inkForFill('accent', colors), bordered: true },
    ghost: { bg: 'transparent', ink: { ink: colors.primary, muted: colors.primary }, bordered: false },
  };
  const { bg, ink, bordered } = fill[variant];
  const inactive = disabled || loading;

  return (
    <InkProvider value={ink}>
      <PressableSurface
        onPress={onPress}
        disabled={inactive}
        dimWhenDisabled={!loading}
        shadow={bordered ? 'md' : 'none'}
        haptic={variant === 'primary' || variant === 'danger' ? 'light' : false}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ busy: loading }}
        testID={testID}
        style={[
          styles.base,
          {
            minHeight: HEIGHT[size],
            paddingHorizontal: PAD_X[size],
            gap: spacing.sm,
            backgroundColor: bg,
            borderRadius: radius.control,
            borderWidth: bordered ? borders.standard : 0,
            borderColor: colors.border,
            alignSelf: fullWidth ? 'stretch' : 'flex-start',
          },
          style,
        ]}
      >
        <View style={[styles.content, { gap: spacing.sm, opacity: loading ? 0 : 1 }]}>
          {icon ? <Icon name={icon.name} fallback={icon.fallback} size={size === 'sm' ? 16 : 20} /> : null}
          <NBText
            variant={size === 'sm' ? 'smallBold' : 'bodyBold'}
            style={size === 'lg' ? styles.lgLabel : null}
            numberOfLines={1}
            dense
          >
            {label}
          </NBText>
        </View>
        {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={ink.ink} /> : null}
      </PressableSurface>
    </InkProvider>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  lgLabel: { fontSize: 18, lineHeight: 24 },
});
