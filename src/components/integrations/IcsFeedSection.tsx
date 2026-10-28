import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Button, NBText, useToast } from '@/components/ui';
import { useRegenerateIcsToken } from '@/data';
import { errorMessage, icsFeedUrl, icsSubscribeUrl } from '@/lib/functions';
import { useTheme } from '@/theme';

import { Panel, Steps } from './common';

const OTHER_APPS = [
  'Google Calendar (web): Other calendars → + → From URL, then paste the link.',
  'Outlook: Add calendar → Subscribe from web, then paste the link.',
] as const;

/** Read-only iCal subscription: works with any calendar app, updates every few hours. */
export function IcsFeedSection({ icsToken }: { icsToken: string }) {
  const theme = useTheme();
  const { colors, spacing, borders, radius } = theme;
  const toast = useToast();
  const regenerate = useRegenerateIcsToken();
  const httpsUrl = icsFeedUrl(icsToken);
  const webcalUrl = icsSubscribeUrl(icsToken);

  const copy = async () => {
    try {
      if (Platform.OS === 'ios') await Clipboard.setUrlAsync(httpsUrl);
      else await Clipboard.setStringAsync(httpsUrl);
      toast.show({ tone: 'success', message: 'Subscription link copied.' });
    } catch {
      toast.show({ tone: 'danger', message: "Couldn't copy the link. Long-press it to select it instead." });
    }
  };

  const addToCalendar = async () => {
    try {
      await Linking.openURL(webcalUrl);
    } catch {
      toast.show({ tone: 'warning', message: "Couldn't open Calendar. Copy the link and add it from your calendar app." });
    }
  };

  const confirmRegenerate = () =>
    Alert.alert(
      'Make a new link?',
      'Calendars subscribed to the current link stop updating. You will need to subscribe again with the new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make new link',
          style: 'destructive',
          onPress: () =>
            regenerate.mutate(undefined, {
              onSuccess: () => toast.show({ tone: 'success', message: 'New subscription link ready. The old one no longer works.' }),
              onError: (error) => toast.show({ tone: 'danger', title: "Couldn't make a new link", message: errorMessage(error) }),
            }),
        },
      ],
    );

  return (
    <Panel eyebrow="Any calendar app" title="Subscribe by link">
      <NBText variant="body" color="muted">
        A read-only feed of your deadlines. Calendar apps refresh it every few hours, so edits show up there with a
        delay.
      </NBText>
      <View
        style={[
          styles.url,
          {
            padding: spacing.md,
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            borderWidth: borders.hairline,
            borderRadius: radius.control,
          },
        ]}
      >
        <NBText variant="small" selectable numberOfLines={3} accessibilityLabel="Your private subscription link">
          {webcalUrl}
        </NBText>
      </View>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Button
          label="Add to Calendar"
          icon={{ name: 'calendar.badge.plus', fallback: '+' }}
          onPress={() => void addToCalendar()}
          style={styles.flex}
          fullWidth
        />
        <Button
          label="Copy link"
          variant="secondary"
          icon={{ name: 'doc.on.doc', fallback: '⧉' }}
          onPress={() => void copy()}
        />
      </View>
      <Steps steps={OTHER_APPS} />
      <NBText variant="small" color="muted">
        Anyone with this link can see your deadlines. Keep it to yourself.
      </NBText>
      <Button
        label="Make a new link"
        variant="ghost"
        size="sm"
        loading={regenerate.isPending}
        onPress={confirmRegenerate}
        accessibilityHint="The old link stops working"
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  url: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
