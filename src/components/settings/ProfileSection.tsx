import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, NBText, TextField } from '@/components/ui';
import { validateDisplayName } from '@/lib/auth';
import { deviceTimeZone } from '@/lib/dates';
import { useTheme } from '@/theme';

import type { ProfileAutosave } from './useProfileAutosave';

/** "America/New_York" -> "America / New York". */
function readableZone(zone: string): string {
  return zone.replace(/_/g, ' ').replace(/\//g, ' / ');
}

/**
 * Name (saved when the field is left, never while it is empty) and the planning time zone,
 * with a one-tap switch when the phone has moved to another zone.
 */
export function ProfileSection({ settings, email }: { settings: ProfileAutosave; email: string | null }) {
  const { spacing } = useTheme();
  const saved = settings.value('display_name') ?? '';
  const [name, setName] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const zone = settings.value('timezone');
  const device = deviceTimeZone();

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === saved.trim()) {
      setError(null);
      return;
    }
    const problem = validateDisplayName(trimmed);
    setError(problem);
    if (!problem) settings.set('display_name', trimmed);
  };

  return (
    <Card style={{ gap: spacing.lg }}>
      <TextField
        label="Your name"
        value={name}
        onChangeText={(next) => {
          setName(next);
          if (error) setError(null);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        error={error}
        helper={email ? `Signed in as ${email}` : undefined}
      />
      <View style={{ gap: spacing.xs }}>
        <NBText variant="label" color="muted">
          Time zone
        </NBText>
        <NBText variant="bodyMedium">{readableZone(zone)}</NBText>
        {zone !== device ? (
          <View style={{ gap: spacing.sm }}>
            <NBText variant="small" color="muted">
              {`Your phone is set to ${readableZone(device)}. Days and reminders follow the zone above.`}
            </NBText>
            <Button
              label={`Use ${readableZone(device)}`}
              variant="secondary"
              size="sm"
              onPress={() => settings.set('timezone', device)}
            />
          </View>
        ) : (
          <NBText variant="small" color="muted">
            Matches your phone. Days start at midnight here.
          </NBText>
        )}
      </View>
    </Card>
  );
}
