import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

export interface ErrorBannerProps {
  message: string;
  title?: string;
  /** danger = something failed; warning = needs attention. */
  tone?: 'danger' | 'warning';
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ErrorBanner({
  message,
  title,
  tone = 'danger',
  onRetry,
  retryLabel = 'Try again',
  style,
}: ErrorBannerProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing } = theme;
  return (
    <InkProvider value={inkForFill('accent', colors)}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          {
            gap: spacing.sm,
            padding: spacing.lg,
            backgroundColor: tone === 'danger' ? colors.red : colors.orange,
            borderColor: colors.border,
            borderWidth: borders.standard,
            borderRadius: radius.card,
          },
          theme.shadow('sm'),
          style,
        ]}
      >
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={20} />
          <View style={styles.text}>
            {title ? <NBText variant="bodyBold">{title}</NBText> : null}
            <NBText variant={title ? 'small' : 'bodyMedium'}>{message}</NBText>
          </View>
        </View>
        {onRetry ? <Button label={retryLabel} variant="secondary" size="sm" onPress={onRetry} /> : null}
      </View>
    </InkProvider>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
});
