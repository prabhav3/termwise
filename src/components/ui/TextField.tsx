import { useState, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

import { NBText } from './NBText';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Shown in red under the field; also marks the field invalid for VoiceOver. */
  error?: string | null;
  helper?: string;
  /** Rendered inside the field on the right, e.g. a show-password button. */
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  ref?: Ref<TextInputInstance>;
}

export function TextField({
  label,
  error,
  helper,
  right,
  multiline,
  containerStyle,
  onFocus,
  onBlur,
  ref,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing, type } = theme;
  const [focused, setFocused] = useState(false);
  const hint = error ?? helper;

  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      <NBText variant="label" color="muted" accessible={false}>
        {label}
      </NBText>
      <View
        style={[
          styles.box,
          {
            minHeight: multiline ? 112 : 52,
            backgroundColor: colors.surface,
            borderColor: error ? colors.red : focused ? colors.primary : colors.border,
            borderWidth: borders.standard,
            borderRadius: radius.control,
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
          },
          focused ? theme.shadow('sm') : null,
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint ?? undefined}
          aria-invalid={error ? true : undefined}
          placeholderTextColor={colors.inkMuted}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          keyboardAppearance={theme.scheme}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          maxFontSizeMultiplier={1.4}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[type.body, styles.input, { color: colors.ink, paddingVertical: multiline ? spacing.md : spacing.sm }]}
          {...inputProps}
        />
        {right}
      </View>
      {error ? (
        <NBText variant="smallBold" color="danger" accessibilityRole="alert">
          {`⚠ ${error}`}
        </NBText>
      ) : helper ? (
        <NBText variant="small" color="muted">
          {helper}
        </NBText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, alignSelf: 'stretch' },
});
