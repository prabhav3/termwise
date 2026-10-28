// Google / Outlook connect: calendar-oauth-start -> ASWebAuthenticationSession -> the callback
// redirects to termwise://integrations/calendar?status=authorized&provider=google&pending=<code>
// (or status=error&message=...). The app then calls calendar-oauth-finish with that one-time
// code; the server attaches the calendar only to the account that started the flow. The redirect
// comes back as the auth session's result on iOS, or as a deep link into the calendar screen
// elsewhere; both land in handleRedirect.
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';

import type { CloudCalendarProvider } from '@shared/api.ts';

import { useToast } from '@/components/ui';
import { queryKeys, useCalendarOAuthFinish, useCalendarOAuthStart, useCalendarSync } from '@/data';
import { errorMessage } from '@/lib/functions';

import { CALENDAR_PROVIDER_NAMES, syncSummary } from './format';

export const CALENDAR_RETURN_PATH = '/integrations/calendar';

export interface OAuthRedirect {
  status?: string;
  provider?: string;
  message?: string;
  /** One-time code for calendar-oauth-finish (status=authorized). */
  pending?: string;
}

function isCloudProvider(value: unknown): value is CloudCalendarProvider {
  return value === 'google' || value === 'microsoft';
}

function single(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function readRedirect(url: string): OAuthRedirect {
  const { queryParams } = Linking.parse(url);
  return {
    status: single(queryParams?.status),
    provider: single(queryParams?.provider),
    message: single(queryParams?.message),
    pending: single(queryParams?.pending),
  };
}

export function useCloudCalendarConnect() {
  const client = useQueryClient();
  const toast = useToast();
  const start = useCalendarOAuthStart();
  const finish = useCalendarOAuthFinish();
  const sync = useCalendarSync();
  // A redirect that arrives as a deep link opens the calendar screen, which forwards status /
  // provider / message; its one-time `pending` code is read from the same route here.
  const routeParams = useLocalSearchParams<{ pending?: string }>();
  const routePending = single(routeParams.pending);
  const [connecting, setConnecting] = useState<CloudCalendarProvider | null>(null);
  const handled = useRef<string | null>(null);

  /** First sync right after connecting, so the Termwise calendar fills in at once. */
  const firstSync = async (connectionId: string) => {
    try {
      const response = await sync.mutateAsync(connectionId);
      const result = response.results.find((row) => row.connection_id === connectionId);
      if (result) {
        toast.show(
          syncSummary({
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            externalChanges: result.external_changes,
            errors: result.errors,
          }),
        );
      }
    } catch (error) {
      toast.show({ tone: 'warning', title: 'Connected, but the first sync failed', message: errorMessage(error) });
    }
  };

  /** Handles the callback's query params once per distinct redirect. */
  const handleRedirect = async (redirect: OAuthRedirect) => {
    if (!redirect.status) return;
    const pending = redirect.pending ?? routePending;
    const key = `${redirect.status}|${redirect.provider ?? ''}|${redirect.message ?? ''}|${pending ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    if (!redirect.pending && routePending) router.setParams({ pending: undefined });
    const name = isCloudProvider(redirect.provider) ? CALENDAR_PROVIDER_NAMES[redirect.provider] : 'Your calendar';
    if (redirect.status === 'authorized' && pending) {
      try {
        const connection = await finish.mutateAsync(pending);
        toast.show({
          tone: 'success',
          title: `${CALENDAR_PROVIDER_NAMES[connection.provider]} connected`,
          message: 'Adding your deadlines now…',
        });
        await firstSync(connection.connection_id);
      } catch (error) {
        toast.show({ tone: 'danger', title: `Couldn't connect ${name}`, message: errorMessage(error) });
      }
      return;
    }
    void client.invalidateQueries({ queryKey: queryKeys.calendarConnections() });
    toast.show({
      tone: 'danger',
      title: `Couldn't connect ${name}`,
      message: redirect.message ?? 'The sign-in did not finish. Please try again.',
    });
  };

  const connect = async (provider: CloudCalendarProvider) => {
    setConnecting(provider);
    handled.current = null;
    try {
      const returnUrl = Linking.createURL(CALENDAR_RETURN_PATH);
      const { auth_url } = await start.mutateAsync({ provider, return_url: returnUrl });
      const result = await WebBrowser.openAuthSessionAsync(auth_url, returnUrl);
      if (result.type === 'success') await handleRedirect(readRedirect(result.url));
    } catch (error) {
      toast.show({
        tone: 'danger',
        title: `Couldn't connect ${CALENDAR_PROVIDER_NAMES[provider]}`,
        message: errorMessage(error),
      });
    } finally {
      setConnecting(null);
    }
  };

  return { connect, connecting, handleRedirect };
}
