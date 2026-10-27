import { type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type SymbolName } from './Icon';
import { InkProvider, inkForFill } from './ink';
import { PressableSurface } from './PressableSurface';

export interface IconButtonProps {
  icon: SymbolName;
  fallback: string;
  /** Spoken label — required, the icon alone says nothing to VoiceOver. */
  label: string;
  onPress?: () => void;
  variant?: 'secondary' | 'primary' | 'ghost';
  disabled?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  icon,
  fallback,
  label,
  onPress,
  variant = 'secondary',
  disabled,
  size = 44,
  style,
  testID,
}: IconButtonProps) {
  const { colors, borders, radius, minTouch } = useTheme();
  const ghost = variant === 'ghost';
  const ink =
    variant === 'primary'
      ? inkForFill('primary', colors)
      : ghost
        ? { ink: colors.ink, muted: colors.inkMuted }
        : inkForFill('surface', colors);
  const slop = Math.max(0, (minTouch - size) / 2);

  return (
    <InkProvider value={ink}>
      <PressableSurface
        onPress={onPress}
        disabled={disabled}
        shadow={ghost ? 'none' : 'sm'}
        haptic={variant === 'primary' ? 'light' : 'selection'}
        accessibilityLabel={label}
        hitSlop={slop}
        testID={testID}
        style={[
          {
            width: size,
            height: size,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.control,
            borderWidth: ghost ? 0 : borders.standard,
            borderColor: colors.border,
            backgroundColor: variant === 'primary' ? colors.primary : ghost ? 'transparent' : colors.surface,
          },
          style,
        ]}
      >
        <Icon name={icon} fallback={fallback} size={Math.round(size * 0.45)} />
      </PressableSurface>
    </InkProvider>
  );
}
