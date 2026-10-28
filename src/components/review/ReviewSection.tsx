import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, NBText } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface ReviewSectionProps {
  title: string;
  /** One line shown under the title, e.g. "4 categories · adds up to 100%". */
  summary?: string;
  defaultOpen?: boolean;
  /** Extra control on the right of the header (e.g. an Add button), shown while open. */
  action?: ReactNode;
  /** Controlled mode (e.g. a warning's "Fix" button opens the section). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/** A collapsible block so a long syllabus stays calm: open the parts you want to check. */
export function ReviewSection({ title, summary, defaultOpen = false, action, open: controlled, onOpenChange, children }: ReviewSectionProps) {
  const { colors, borders, spacing } = useTheme();
  const [internal, setInternal] = useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternal(next);
  };
  return (
    <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
      <View style={[styles.header, { gap: spacing.sm, borderBottomWidth: borders.hairline, borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={summary ? `${title}, ${summary}` : title}
          accessibilityState={{ expanded: open }}
          accessibilityHint={open ? 'Collapses this section' : 'Expands this section'}
          onPress={() => {
            haptic('selection');
            setOpen(!open);
          }}
          style={[styles.toggle, { gap: spacing.sm, paddingVertical: spacing.sm }]}
        >
          <Icon name={open ? 'chevron.down' : 'chevron.right'} fallback={open ? '▾' : '▸'} size={16} />
          <View style={styles.flex}>
            <NBText variant="h3">{title}</NBText>
            {summary ? (
              <NBText variant="small" color="muted">
                {summary}
              </NBText>
            ) : null}
          </View>
        </Pressable>
        {open && action ? action : null}
      </View>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  flex: { flex: 1 },
});
