// Haptic feedback for primary actions. Fire-and-forget: devices without a Taptic Engine,
// simulators and web reject or no-op, and that must never surface as an error.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'light' | 'medium' | 'selection' | 'success' | 'warning' | 'error';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

export function haptic(kind: HapticKind = 'light'): void {
  if (!supported) return;
  let pending: Promise<void>;
  switch (kind) {
    case 'light':
      pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      pending = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'selection':
      pending = Haptics.selectionAsync();
      break;
    case 'success':
      pending = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      pending = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      pending = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
  pending.catch(() => undefined);
}
