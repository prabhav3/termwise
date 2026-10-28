import { useState } from 'react';
import { View } from 'react-native';

import type { CanvasConnectResponse } from '@shared/api.ts';

import { Button, ErrorBanner, IconButton, NBText, TextField } from '@/components/ui';
import { useCanvasConnect } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

import { Panel, Steps } from './common';

const TOKEN_STEPS = [
  'Sign in to Canvas in a browser and open Account → Settings.',
  'Under “Approved Integrations”, tap “+ New Access Token”.',
  'Name it “Termwise”, leave the expiry blank (or pick the end of term), and generate it.',
  'Copy the token and paste it below. Canvas shows it only once.',
] as const;

export interface CanvasConnectFormProps {
  /** Prefilled school address (reconnecting an expired token). */
  initialUrl?: string;
  reconnect?: boolean;
  onConnected: (response: CanvasConnectResponse) => void;
}

function validateUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Enter the address you use to sign in to Canvas.';
  if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)) return 'That doesn’t look like a web address.';
  return null;
}

/** School Canvas URL + personal access token. The token is sent once and stored only on the server. */
export function CanvasConnectForm({ initialUrl = '', reconnect = false, onConnected }: CanvasConnectFormProps) {
  const { spacing } = useTheme();
  const connect = useCanvasConnect();
  const [baseUrl, setBaseUrl] = useState(initialUrl);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const submit = () => {
    const nextUrlError = validateUrl(baseUrl);
    const nextTokenError = token.trim().length < 20 ? 'Paste the whole access token from Canvas.' : null;
    setUrlError(nextUrlError);
    setTokenError(nextTokenError);
    if (nextUrlError || nextTokenError) return;
    connect.mutate(
      { baseUrl, accessToken: token },
      {
        onSuccess: (response) => {
          setToken('');
          onConnected(response);
        },
      },
    );
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {reconnect ? (
        <ErrorBanner
          tone="warning"
          title="Canvas stopped accepting your token"
          message="Tokens expire or get revoked. Make a new one in Canvas and paste it here — your courses stay linked."
        />
      ) : null}

      <Panel eyebrow="Step 1" title="Make an access token">
        <Steps steps={TOKEN_STEPS} />
        <NBText variant="small" color="muted">
          Some schools turn access tokens off. If you don’t see the button, upload your syllabus instead, or use your
          LMS calendar feed.
        </NBText>
      </Panel>

      <Panel eyebrow="Step 2" title="Connect">
        <TextField
          label="School Canvas address"
          placeholder="school.instructure.com"
          value={baseUrl}
          onChangeText={(text) => {
            setBaseUrl(text);
            setUrlError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="next"
          error={urlError}
        />
        <TextField
          label="Access token"
          placeholder="Paste your token"
          value={token}
          onChangeText={(text) => {
            setToken(text);
            setTokenError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showToken}
          textContentType="none"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={tokenError}
          helper="Sent once over HTTPS and stored encrypted on Termwise’s server — never on this phone."
          right={
            <IconButton
              icon={showToken ? 'eye.slash' : 'eye'}
              fallback={showToken ? '◡' : '◉'}
              label={showToken ? 'Hide token' : 'Show token'}
              variant="ghost"
              onPress={() => setShowToken((value) => !value)}
            />
          }
        />
        {connect.error ? <ErrorBanner title="Couldn't connect to Canvas" message={errorMessage(connect.error)} /> : null}
        <Button
          label={reconnect ? 'Reconnect Canvas' : 'Connect Canvas'}
          fullWidth
          loading={connect.isPending}
          onPress={submit}
        />
      </Panel>
    </View>
  );
}
