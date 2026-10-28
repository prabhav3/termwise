import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { NBText } from './NBText';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** Pinned under the content, e.g. Save / Done buttons. */
  footer?: ReactNode;
}

/** Bottom modal card. Tapping the scrim or the close button dismisses it. */
export function Sheet({ visible, onClose, title, children, footer }: SheetProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing, motion } = theme;
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Animated.View entering={FadeIn.duration(motion.enterMs)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
          <Pressable
            style={styles.fill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <View style={[styles.anchor, { paddingTop: insets.top }]} pointerEvents="box-none">
          <Animated.View
            entering={SlideInDown.duration(motion.enterMs)}
            accessibilityViewIsModal
            style={[
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: borders.standard,
                borderBottomWidth: 0,
                borderTopLeftRadius: radius.card,
                borderTopRightRadius: radius.card,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: Math.max(insets.bottom, spacing.lg),
                gap: spacing.md,
                // With the keyboard up the card shrinks (its ScrollView content scrolls) instead
                // of overflowing past the top of the screen.
                maxHeight: '100%',
                flexShrink: 1,
              },
              theme.shadow('lg'),
            ]}
          >
            <View style={[styles.header, { gap: spacing.md }]}>
              <View style={styles.title}>{title ? <NBText variant="h2">{title}</NBText> : null}</View>
              <IconButton icon="xmark" fallback="✕" label="Close" variant="ghost" onPress={onClose} />
            </View>
            {children}
            {footer}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
});
