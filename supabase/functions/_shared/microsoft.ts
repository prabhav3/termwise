// Microsoft identity platform (auth code flow, tenant "common") + Microsoft Graph calendars,
// events and To Do. Runtime-agnostic; credentials are passed in by the edge functions.
import {
  type AccessTokenSource,
  addDays,
  type CalendarAdapter,
  type CalendarEntry,
  CONTAINER_NAME,
  type ExternalKind,
  type ExternalObservation,
  type ExternalSnapshot,
  oauthTokenRequest,
  ProviderError,
  providerJson,
  type ProviderRequest,
  timedRange,
  utcToLocal,
} from './calendar-model.ts';
import type { OAuthClient, OAuthTokenResponse } from './google.ts';

export const MICROSOFT_SCOPES = ['offline_access', 'Calendars.ReadWrite', 'Tasks.ReadWrite', 'User.Read'] as const;

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Named extended property that carries our entry key on Outlook events. */
const KEY_PROPERTY_ID = 'String {6f1d2c3a-8b4e-4f7a-9c2d-5e8f0a1b3c4d} Name termwiseKey';

export function microsoftAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(`${AUTHORITY}/authorize`);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    redirect_uri: params.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    prompt: 'select_account',
    state: params.state,
  }).toString();
  return url.href;
}

export function exchangeMicrosoftCode(client: OAuthClient, code: string, redirectUri: string): Promise<OAuthTokenResponse> {
  return oauthTokenRequest<OAuthTokenResponse>('microsoft', `${AUTHORITY}/token`, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    scope: MICROSOFT_SCOPES.join(' '),
  });
}

/** Microsoft rotates refresh tokens: store the returned refresh_token when present. */
export function refreshMicrosoftToken(client: OAuthClient, refreshToken: string): Promise<OAuthTokenResponse> {
  return oauthTokenRequest<OAuthTokenResponse>('microsoft', `${AUTHORITY}/token`, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    scope: MICROSOFT_SCOPES.join(' '),
  });
}

export async function fetchMicrosoftEmail(accessToken: string): Promise<string | null> {
  const tokens: AccessTokenSource = { get: () => Promise.resolve(accessToken) };
  const me = await providerJson<{ mail?: string | null; userPrincipalName?: string | null }>('microsoft', tokens, {
    method: 'GET',
    url: `${GRAPH}/me?$select=mail,userPrincipalName`,
  });
  return me?.mail ?? me?.userPrincipalName ?? null;
}

// ---------------------------------------------------------------------------
// Graph adapter
// ---------------------------------------------------------------------------

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

interface GraphEvent {
  id: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: GraphDateTime;
  end?: GraphDateTime;
  singleValueExtendedProperties?: Array<{ id: string; value: string }>;
}

interface GraphTask {
  id: string;
  dueDateTime?: GraphDateTime | null;
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

const MAX_PAGES = 40;

/** Graph returns "2026-11-03T21:00:00.0000000" plus a zone name; we always ask for UTC. */
function graphInstant(value: GraphDateTime): string | null {
  const base = value.dateTime.slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(base)) return null;
  return value.timeZone.toUpperCase() === 'UTC' ? `${base}Z` : null;
}

export function observeGraphEvent(event: GraphEvent, timeZone: string): ExternalObservation {
  const key = event.singleValueExtendedProperties?.find((p) => p.id.toLowerCase() === KEY_PROPERTY_ID.toLowerCase())?.value ?? null;
  if (event.isCancelled) return { externalId: event.id, deleted: true, date: null, time: null, key };
  if (event.isAllDay && event.start) {
    return { externalId: event.id, deleted: false, date: event.start.dateTime.slice(0, 10), time: null, key };
  }
  const end = event.end ? graphInstant(event.end) : null;
  if (!end) return { externalId: event.id, deleted: false, date: event.end?.dateTime.slice(0, 10) ?? null, time: null, key };
  const local = utcToLocal(end, timeZone);
  return { externalId: event.id, deleted: false, date: local.date, time: local.time, key };
}

export function graphTaskDate(task: GraphTask, timeZone: string): string | null {
  const due = task.dueDateTime;
  if (!due) return null;
  const instant = graphInstant(due);
  return instant ? utcToLocal(instant, timeZone).date : due.dateTime.slice(0, 10);
}

const isoNoZone = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export function graphEventBody(entry: CalendarEntry): Record<string, unknown> {
  const base = {
    subject: entry.title,
    body: { contentType: 'text', content: entry.description },
    showAs: 'free',
    singleValueExtendedProperties: [{ id: KEY_PROPERTY_ID, value: entry.key }],
  };
  if (!entry.time) {
    // All-day events must start and end at midnight in their own zone.
    return {
      ...base,
      isAllDay: true,
      start: { dateTime: `${entry.date}T00:00:00`, timeZone: entry.timeZone },
      end: { dateTime: `${addDays(entry.date, 1)}T00:00:00`, timeZone: entry.timeZone },
    };
  }
  const { startMs, endMs } = timedRange(entry);
  return {
    ...base,
    isAllDay: false,
    start: { dateTime: isoNoZone(startMs), timeZone: 'UTC' },
    end: { dateTime: isoNoZone(endMs), timeZone: 'UTC' },
  };
}

export function graphTaskBody(entry: CalendarEntry): Record<string, unknown> {
  return {
    title: entry.title,
    body: { contentType: 'text', content: entry.description },
    dueDateTime: { dateTime: `${entry.date}T00:00:00`, timeZone: entry.timeZone },
  };
}

const enc = encodeURIComponent;

export class MicrosoftCalendarAdapter implements CalendarAdapter {
  readonly provider = 'microsoft' as const;

  constructor(
    private readonly tokens: AccessTokenSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private call<T>(method: ProviderRequest['method'], url: string, body?: unknown, headers?: Record<string, string>): Promise<T | null> {
    return providerJson<T>('microsoft', this.tokens, { method, url, body, headers }, this.fetchImpl);
  }

  private async listAll<T>(firstUrl: string, headers?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = firstUrl;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const result: GraphPage<T> | null = await this.call<GraphPage<T>>('GET', url, undefined, headers);
      out.push(...(result?.value ?? []));
      const next: string | undefined = result?.['@odata.nextLink'];
      url = next && next.startsWith(`${GRAPH}/`) ? next : undefined;
    }
    return out;
  }

  async ensureContainer(kind: ExternalKind, knownId: string | null): Promise<string> {
    if (knownId) return knownId;
    if (kind === 'event') {
      const calendars = await this.listAll<{ id: string; name?: string; canEdit?: boolean }>(
        `${GRAPH}/me/calendars?$select=id,name,canEdit&$top=100`,
      );
      const existing = calendars.find((c) => c.name === CONTAINER_NAME && c.canEdit !== false);
      if (existing) return existing.id;
      const created = await this.call<{ id: string }>('POST', `${GRAPH}/me/calendars`, { name: CONTAINER_NAME });
      if (!created?.id) throw new ProviderError('microsoft', 502, 'Outlook did not return the new calendar.');
      return created.id;
    }
    const lists = await this.listAll<{ id: string; displayName?: string }>(`${GRAPH}/me/todo/lists?$top=100`);
    const existing = lists.find((l) => l.displayName === CONTAINER_NAME);
    if (existing) return existing.id;
    const created = await this.call<{ id: string }>('POST', `${GRAPH}/me/todo/lists`, { displayName: CONTAINER_NAME });
    if (!created?.id) throw new ProviderError('microsoft', 502, 'Microsoft To Do did not return the new list.');
    return created.id;
  }

  /** Full listing of the dedicated container (it holds only our entries, so this stays small). */
  async snapshot(kind: ExternalKind, containerId: string, _cursor: string | null, timeZone: string): Promise<{ snapshot: ExternalSnapshot; cursor: null }> {
    if (kind === 'event') {
      const expand = `singleValueExtendedProperties($filter=id eq '${KEY_PROPERTY_ID}')`;
      const events = await this.listAll<GraphEvent>(
        `${GRAPH}/me/calendars/${enc(containerId)}/events?$select=id,isAllDay,isCancelled,start,end&$top=100&$expand=${enc(expand)}`,
        { Prefer: 'outlook.timezone="UTC"' },
      );
      return { snapshot: { complete: true, observations: events.map((e) => observeGraphEvent(e, timeZone)) }, cursor: null };
    }
    const tasks = await this.listAll<GraphTask>(`${GRAPH}/me/todo/lists/${enc(containerId)}/tasks?$select=id,dueDateTime&$top=100`);
    return {
      snapshot: {
        complete: true,
        observations: tasks.map((t) => ({ externalId: t.id, deleted: false, date: graphTaskDate(t, timeZone), time: null, key: null })),
      },
      cursor: null,
    };
  }

  async create(kind: ExternalKind, containerId: string, entry: CalendarEntry): Promise<string> {
    const created =
      kind === 'event'
        ? await this.call<{ id: string }>('POST', `${GRAPH}/me/calendars/${enc(containerId)}/events`, graphEventBody(entry))
        : await this.call<{ id: string }>('POST', `${GRAPH}/me/todo/lists/${enc(containerId)}/tasks`, graphTaskBody(entry));
    if (!created?.id) throw new ProviderError('microsoft', 502, 'Microsoft did not return the new entry.');
    return created.id;
  }

  async update(kind: ExternalKind, containerId: string, externalId: string, entry: CalendarEntry): Promise<void> {
    if (kind === 'event') {
      await this.call('PATCH', `${GRAPH}/me/events/${enc(externalId)}`, graphEventBody(entry));
      return;
    }
    await this.call('PATCH', `${GRAPH}/me/todo/lists/${enc(containerId)}/tasks/${enc(externalId)}`, graphTaskBody(entry));
  }

  async remove(kind: ExternalKind, containerId: string, externalId: string): Promise<void> {
    const url =
      kind === 'event'
        ? `${GRAPH}/me/events/${enc(externalId)}`
        : `${GRAPH}/me/todo/lists/${enc(containerId)}/tasks/${enc(externalId)}`;
    try {
      await this.call<never>('DELETE', url);
    } catch (err) {
      if (err instanceof ProviderError && err.isGone) return;
      throw err;
    }
  }
}
