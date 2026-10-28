// Google / Outlook connect: calendar-oauth-start -> ASWebAuthenticationSession -> the callback
// redirects to termwise://integrations/calendar?status=connected&provider=google (or
// status=error&message=...). The redirect comes back as the auth session's result on iOS, or as a
// deep link into the calendar screen elsewhere; both land in handleRedirect.
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';

import type { CloudCalendarProvider } from '@shared/api.ts';

import { useToast } from '@/components/ui';
import { calendarConnectionsQueryOptions, queryKeys, useCalendarOAuthStart, useCalendarSync } from '@/data';
import { errorMessage } from '@/lib/functions';
import type { CalendarConnection } from '@/types/db';

import { CALENDAR_PROVIDER_NAMES, syncSummary } from './format';

export const CALENDAR_RETURN_PATH = '/integrations/calendar';

export interface OAuthRedirect {
  status?: string;
  provider?: string;
  message?: string;
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
  };
}

export function useCloudCalendarConnect() {
  const client = useQueryClient();
  const toast = useToast();
  const start = useCalendarOAuthStart();
  const sync = useCalendarSync();
  const [connecting, setConnecting] = useState<CloudCalendarProvider | null>(null);
  const handled = useRef<string | null>(null);

  /** First sync right after connecting, so the Termwise calendar fills in at once. */
  const firstSync = async (provider: CloudCalendarProvider) => {
    await client.invalidateQueries({ queryKey: queryKeys.calendarConnections() });
    const connections = await client.fetchQuery(calendarConnectionsQueryOptions());
    const connection = connections.find(
      (row: CalendarConnection) => row.provider === provider && row.status === 'active',
    );
    if (!connection) return;
    try {
      const response = await sync.mutateAsync(connection.id);
      const result = response.results.find((row) => row.connection_id === connection.id);
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
  const handleRedirect = (redirect: OAuthRedirect) => {
    if (!redirect.status) return;
    const key = `${redirect.status}|${redirect.provider ?? ''}|${redirect.message ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    const name = isCloudProvider(redirect.provider) ? CALENDAR_PROVIDER_NAMES[redirect.provider] : 'Your calendar';
    if (redirect.status === 'connected' && isCloudProvider(redirect.provider)) {
      toast.show({ tone: 'success', title: `${name} connected`, message: 'Adding your deadlines now…' });
      void firstSync(redirect.provider);
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
      if (result.type === 'success') handleRedirect(readRedirect(result.url));
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
