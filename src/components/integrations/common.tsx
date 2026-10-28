import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Badge, Card, Icon, InkProvider, inkForFill, NBText, type SymbolName } from '@/components/ui';
import { useTheme, type AccentColor } from '@/theme';

import type { ConnectionState } from './format';

/** Status as text on a colored pill (the words carry the meaning, the color only reinforces it). */
export function StatusBadge({ state, style }: { state: ConnectionState; style?: StyleProp<ViewStyle> }) {
  const prefix = state.tone === 'green' ? '✓ ' : state.tone === 'red' || state.tone === 'orange' ? '! ' : '';
  return (
    <Badge
      label={`${prefix}${state.label}`}
      tone={state.tone}
      accessibilityLabel={`Status: ${state.label}`}
      style={style}
    />
  );
}

/** Square accent tile holding an SF Symbol (decorative). */
export function IconTile({
  icon,
  fallback,
  tone = 'blue',
  size = 44,
}: {
  icon: SymbolName;
  fallback: string;
  tone?: AccentColor;
  size?: number;
}) {
  const { colors, borders, radius } = useTheme();
  return (
    <InkProvider value={inkForFill('accent', colors)}>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors[tone],
          borderColor: colors.border,
          borderWidth: borders.hairline,
          borderRadius: radius.control,
        }}
      >
        <Icon name={icon} fallback={fallback} size={Math.round(size * 0.5)} />
      </View>
    </InkProvider>
  );
}

export interface IntegrationCardProps {
  title: string;
  subtitle: string;
  icon: SymbolName;
  fallback: string;
  tone: AccentColor;
  state: ConnectionState;
  onPress: () => void;
  /** Extra line under the subtitle, e.g. a last error. */
  note?: string | null;
}

/** Hub row: what it is, its state, and one tap to manage it. */
export function IntegrationCard({ title, subtitle, icon, fallback, tone, state, onPress, note }: IntegrationCardProps) {
  const { spacing } = useTheme();
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${title}. ${state.label}. ${subtitle}${note ? `. ${note}` : ''}`}
      accessibilityHint="Opens its settings"
      style={[styles.row, { gap: spacing.md }]}
    >
      <IconTile icon={icon} fallback={fallback} tone={tone} />
      <View style={[styles.text, { gap: spacing.xs }]}>
        <NBText variant="bodyBold" dense numberOfLines={2}>
          {title}
        </NBText>
        <NBText variant="small" color="muted" dense numberOfLines={2}>
          {subtitle}
        </NBText>
        {note ? (
          <NBText variant="small" color="danger" dense numberOfLines={2}>
            {`⚠ ${note}`}
          </NBText>
        ) : null}
        <StatusBadge state={state} style={{ marginTop: spacing.xs }} />
      </View>
      <Icon name="chevron.right" fallback="›" size={14} />
    </Card>
  );
}

/** A titled card section used across the integration screens. */
export function Panel({
  title,
  eyebrow,
  right,
  children,
  color,
  style,
}: {
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children?: ReactNode;
  color?: AccentColor | 'surfaceAlt';
  style?: StyleProp<ViewStyle>;
}) {
  const { spacing } = useTheme();
  return (
    <Card color={color} shadow={color === 'surfaceAlt' ? 'none' : 'md'} style={[{ gap: spacing.md }, style]}>
      {title || eyebrow || right ? (
        <View style={[styles.header, { gap: spacing.md }]}>
          <View style={styles.text}>
            {eyebrow ? (
              <NBText variant="label" color="muted">
                {eyebrow}
              </NBText>
            ) : null}
            {title ? <NBText variant="h3">{title}</NBText> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </Card>
  );
}

/** "Label  value" line for small facts (account, last sync). */
export function Fact({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.fact, { gap: spacing.sm }]}>
      <NBText variant="label" color="muted" dense style={styles.factLabel}>
        {label}
      </NBText>
      <NBText variant="small" dense style={styles.text}>
        {value}
      </NBText>
    </View>
  );
}

/** Numbered how-to steps. */
export function Steps({ steps }: { steps: readonly string[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {steps.map((step, index) => (
        <View key={step} style={[styles.step, { gap: spacing.sm }]} accessible accessibilityLabel={`Step ${index + 1}. ${step}`}>
          <Badge label={String(index + 1)} tone="ink" />
          <NBText variant="small" style={styles.text}>
            {step}
          </NBText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  fact: { flexDirection: 'row', alignItems: 'baseline' },
  factLabel: { minWidth: 92 },
  step: { flexDirection: 'row', alignItems: 'flex-start' },
});
