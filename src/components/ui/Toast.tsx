import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { Icon, type SymbolName } from './Icon';
import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  message: string;
  title?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss (default 3500). */
  duration?: number;
}

interface ToastState extends Required<Omit<ToastOptions, 'title'>> {
  id: number;
  title?: string;
}

interface ToastApi {
  show: (options: ToastOptions | string) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, { name: SymbolName; fallback: string }> = {
  info: { name: 'info.circle.fill', fallback: 'i' },
  success: { name: 'checkmark.circle.fill', fallback: '✓' },
  warning: { name: 'exclamationmark.triangle.fill', fallback: '⚠' },
  danger: { name: 'xmark.octagon.fill', fallback: '!' },
};

/** Hosts one toast at a time at the top of the screen. Wrap the app once, inside ThemeProvider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);

  const api = useMemo<ToastApi>(
    () => ({
      show: (options) => {
        const opts = typeof options === 'string' ? { message: options } : options;
        nextId.current += 1;
        const tone = opts.tone ?? 'info';
        if (tone === 'success') haptic('success');
        else if (tone === 'danger') haptic('error');
        AccessibilityInfo.announceForAccessibility(opts.title ? `${opts.title}. ${opts.message}` : opts.message);
        setToast({ id: nextId.current, message: opts.message, title: opts.title, tone, duration: opts.duration ?? 3500 });
      },
      hide: () => setToast(null),
    }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), toast.duration);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={api}>
      {children}
      {toast ? (
        <ToastLayer key={toast.id}>
          <ToastView toast={toast} onDismiss={api.hide} />
        </ToastLayer>
      ) : null}
    </ToastContext>
  );
}

/**
 * Native-stack modals (Focus, Upload, ...) and Sheets (RN Modal) are presented above the root
 * view, so on iOS the toast is drawn in a window-level overlay. It mounts per toast: the overlay
 * attaches to the window when it mounts, which puts it above whatever is presented at that time.
 * It doesn't trap VoiceOver (the toast is also announced).
 */
function ToastLayer({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'ios') return children;
  return <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{children}</FullWindowOverlay>;
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const theme = useTheme();
  const { colors, borders, radius, spacing, motion } = theme;
  const insets = useSafeAreaInsets();
  const fill = { info: colors.blue, success: colors.green, warning: colors.yellow, danger: colors.red }[toast.tone];
  const icon = ICONS[toast.tone];

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm, left: spacing.gutter, right: spacing.gutter }]}>
      <Animated.View entering={FadeInUp.duration(motion.enterMs)} exiting={FadeOutUp.duration(motion.pressMs)}>
        <InkProvider value={inkForFill('accent', colors)}>
          <Pressable
            accessibilityRole="alert"
            accessibilityLabel={toast.title ? `${toast.title}. ${toast.message}` : toast.message}
            accessibilityHint="Dismisses the message"
            onPress={onDismiss}
            style={[
              styles.toast,
              {
                gap: spacing.sm,
                padding: spacing.md,
                backgroundColor: fill,
                borderColor: colors.border,
                borderWidth: borders.standard,
                borderRadius: radius.control,
              },
              theme.shadow('md'),
            ]}
          >
            <Icon name={icon.name} fallback={icon.fallback} size={20} />
            <View style={styles.text}>
              {toast.title ? <NBText variant="bodyBold">{toast.title}</NBText> : null}
              <NBText variant={toast.title ? 'small' : 'bodyMedium'}>{toast.message}</NBText>
            </View>
          </Pressable>
        </InkProvider>
      </Animated.View>
    </View>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>.');
  return api;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', zIndex: 1000 },
  toast: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, gap: 2 },
});
