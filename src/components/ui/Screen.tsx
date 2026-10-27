import type { ReactElement, ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { NBText } from './NBText';

export interface ScreenProps {
  children?: ReactNode;
  /** Large title header (Archivo Black). */
  title?: string;
  /** Small uppercase line above the title, e.g. the date. */
  eyebrow?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  /** Scrollable content (default). Pass false for screens that lay out their own list. */
  scroll?: boolean;
  /** Pinned below the content, e.g. the primary action of a form. */
  footer?: ReactNode;
  /** Safe-area edges to pad when the platform does not inset automatically. Modals usually want ['bottom']. */
  edges?: readonly ('top' | 'bottom')[];
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Safe area + paper background + optional large title. iOS scroll views inset themselves (tab bar, home indicator). */
export function Screen({
  children,
  title,
  eyebrow,
  subtitle,
  headerRight,
  scroll = true,
  footer,
  edges = ['top', 'bottom'],
  refreshControl,
  contentContainerStyle,
}: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const autoInsets = scroll && Platform.OS === 'ios';
  const padTop = !autoInsets && edges.includes('top') ? insets.top : 0;
  const padBottom = !autoInsets && edges.includes('bottom') && !footer ? insets.bottom : 0;

  const header =
    title || eyebrow || headerRight ? (
      <View style={[styles.header, { marginBottom: spacing.lg, gap: spacing.md }]}>
        <View style={styles.headerText}>
          {eyebrow ? (
            <NBText variant="label" color="muted">
              {eyebrow}
            </NBText>
          ) : null}
          {title ? <NBText variant="display">{title}</NBText> : null}
          {subtitle ? (
            <NBText variant="body" color="muted" style={{ marginTop: spacing.xs }}>
              {subtitle}
            </NBText>
          ) : null}
        </View>
        {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
      </View>
    ) : null;

  const padding: ViewStyle = {
    paddingHorizontal: spacing.gutter,
    paddingTop: padTop + spacing.lg,
    paddingBottom: padBottom + spacing.xxl,
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[padding, contentContainerStyle]}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={refreshControl}
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, padding, contentContainerStyle]}>
          {header}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={{
            paddingHorizontal: spacing.gutter,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            backgroundColor: colors.bg,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end' },
  headerText: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
});
