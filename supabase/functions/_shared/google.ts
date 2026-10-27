// Google OAuth 2.0 (web server flow) + Google Calendar API v3 + Google Tasks API.
// Runtime-agnostic; credentials are passed in by the edge functions.
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

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
] as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export function googleAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: params.state,
  }).toString();
  return url.href;
}

export function exchangeGoogleCode(client: OAuthClient, code: string, redirectUri: string): Promise<OAuthTokenResponse> {
  return oauthTokenRequest<OAuthTokenResponse>('google', TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

export function refreshGoogleToken(client: OAuthClient, refreshToken: string): Promise<OAuthTokenResponse> {
  return oauthTokenRequest<OAuthTokenResponse>('google', TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const tokens: AccessTokenSource = { get: () => Promise.resolve(accessToken) };
  const info = await providerJson<{ email?: string }>('google', tokens, { method: 'GET', url: USERINFO_URL });
  return typeof info?.email === 'string' ? info.email : null;
}

/** True when the granted scopes cover what calendar-sync needs. */
export function googleScopesSufficient(scope: string | undefined): boolean {
  if (!scope) return true; // Google omits `scope` only when everything requested was granted
  const granted = new Set(scope.split(/\s+/));
  return granted.has('https://www.googleapis.com/auth/calendar') && granted.has('https://www.googleapis.com/auth/tasks');
}

// ---------------------------------------------------------------------------
// Calendar + Tasks adapter
// ---------------------------------------------------------------------------

interface GoogleDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleEventList {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleTask {
  id: string;
  due?: string;
  deleted?: boolean;
}

interface GoogleList<T> {
  items?: T[];
  nextPageToken?: string;
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  accessRole?: string;
  deleted?: boolean;
}

const KEY_PROPERTY = 'termwiseKey';
const MAX_PAGES = 40;

export function observeGoogleEvent(event: GoogleEvent, timeZone: string): ExternalObservation {
  const key = event.extendedProperties?.private?.[KEY_PROPERTY] ?? null;
  if (event.status === 'cancelled') return { externalId: event.id, deleted: true, date: null, time: null, key };
  if (event.start?.date) return { externalId: event.id, deleted: false, date: event.start.date, time: null, key };
  const end = event.end?.dateTime ?? event.start?.dateTime;
  if (!end || !Number.isFinite(Date.parse(end))) return { externalId: event.id, deleted: false, date: null, time: null, key };
  const local = utcToLocal(end, timeZone);
  return { externalId: event.id, deleted: false, date: local.date, time: local.time, key };
}

/** Event resource for insert / patch. Null sub-fields clear the other date form on patch. */
export function googleEventBody(entry: CalendarEntry): Record<string, unknown> {
  const base = {
    summary: entry.title,
    description: entry.description,
    transparency: 'transparent',
    extendedProperties: { private: { [KEY_PROPERTY]: entry.key } },
  };
  if (!entry.time) {
    return {
      ...base,
      start: { date: entry.date, dateTime: null, timeZone: null },
      end: { date: addDays(entry.date, 1), dateTime: null, timeZone: null },
    };
  }
  const { startMs, endMs } = timedRange(entry);
  return {
    ...base,
    start: { dateTime: new Date(startMs).toISOString(), timeZone: entry.timeZone, date: null },
    end: { dateTime: new Date(endMs).toISOString(), timeZone: entry.timeZone, date: null },
  };
}

export function googleTaskBody(entry: CalendarEntry): Record<string, unknown> {
  // Google Tasks keeps only the date part of `due`.
  return { title: entry.title, notes: entry.description, due: `${entry.date}T00:00:00.000Z` };
}

const enc = encodeURIComponent;

export class GoogleCalendarAdapter implements CalendarAdapter {
  readonly provider = 'google' as const;

  constructor(
    private readonly tokens: AccessTokenSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private call<T>(method: ProviderRequest['method'], url: string, body?: unknown): Promise<T | null> {
    return providerJson<T>('google', this.tokens, { method, url, body }, this.fetchImpl);
  }

  async ensureContainer(kind: ExternalKind, knownId: string | null, timeZone: string): Promise<string> {
    if (knownId) return knownId;
    if (kind === 'event') {
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ minAccessRole: 'owner', maxResults: '250' });
        if (pageToken) query.set('pageToken', pageToken);
        const list = await this.call<GoogleList<GoogleCalendarListEntry>>('GET', `${CALENDAR_API}/users/me/calendarList?${query}`);
        const existing = list?.items?.find((c) => c.summary === CONTAINER_NAME && !c.deleted);
        if (existing) return existing.id;
        pageToken = list?.nextPageToken;
        if (!pageToken) break;
      }
      const created = await this.call<{ id: string }>('POST', `${CALENDAR_API}/calendars`, {
        summary: CONTAINER_NAME,
        description: 'Deadlines and study plan from Termwise. Edits to dates here come back to the app for review.',
        timeZone,
      });
      if (!created?.id) throw new ProviderError('google', 502, 'Google did not return the new calendar.');
      return created.id;
    }
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ maxResults: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const lists = await this.call<GoogleList<{ id: string; title?: string }>>('GET', `${TASKS_API}/users/@me/lists?${query}`);
      const existing = lists?.items?.find((l) => l.title === CONTAINER_NAME);
      if (existing) return existing.id;
      pageToken = lists?.nextPageToken;
      if (!pageToken) break;
    }
    const created = await this.call<{ id: string }>('POST', `${TASKS_API}/users/@me/lists`, { title: CONTAINER_NAME });
    if (!created?.id) throw new ProviderError('google', 502, 'Google did not return the new task list.');
    return created.id;
  }

  snapshot(
    kind: ExternalKind,
    containerId: string,
    cursor: string | null,
    timeZone: string,
  ): Promise<{ snapshot: ExternalSnapshot; cursor: string | null }> {
    return kind === 'event' ? this.eventSnapshot(containerId, cursor, timeZone) : this.taskSnapshot(containerId);
  }

  private async eventSnapshot(
    calendarId: string,
    cursor: string | null,
    timeZone: string,
  ): Promise<{ snapshot: ExternalSnapshot; cursor: string | null }> {
    const observations: ExternalObservation[] = [];
    let pageToken: string | undefined;
    let nextCursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ maxResults: '250' });
      if (cursor) query.set('syncToken', cursor);
      if (pageToken) query.set('pageToken', pageToken);
      let list: GoogleEventList | null;
      try {
        list = await this.call<GoogleEventList>('GET', `${CALENDAR_API}/calendars/${enc(calendarId)}/events?${query}`);
      } catch (err) {
        // 410: the sync token expired — start over with a full listing.
        if (cursor && err instanceof ProviderError && err.status === 410) return this.eventSnapshot(calendarId, null, timeZone);
        throw err;
      }
      for (const event of list?.items ?? []) observations.push(observeGoogleEvent(event, timeZone));
      if (list?.nextPageToken) {
        pageToken = list.nextPageToken;
        continue;
      }
      nextCursor = list?.nextSyncToken ?? null;
      break;
    }
    return { snapshot: { complete: cursor === null, observations }, cursor: nextCursor };
  }

  private async taskSnapshot(taskListId: string): Promise<{ snapshot: ExternalSnapshot; cursor: null }> {
    const observations: ExternalObservation[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'true' });
      if (pageToken) query.set('pageToken', pageToken);
      const list = await this.call<GoogleList<GoogleTask>>('GET', `${TASKS_API}/lists/${enc(taskListId)}/tasks?${query}`);
      for (const task of list?.items ?? []) {
        observations.push({
          externalId: task.id,
          deleted: task.deleted === true,
          date: task.due ? task.due.slice(0, 10) : null,
          time: null,
          key: null,
        });
      }
      pageToken = list?.nextPageToken;
      if (!pageToken) break;
    }
    return { snapshot: { complete: true, observations }, cursor: null };
  }

  async create(kind: ExternalKind, containerId: string, entry: CalendarEntry): Promise<string> {
    const created =
      kind === 'event'
        ? await this.call<{ id: string }>('POST', `${CALENDAR_API}/calendars/${enc(containerId)}/events`, googleEventBody(entry))
        : await this.call<{ id: string }>('POST', `${TASKS_API}/lists/${enc(containerId)}/tasks`, googleTaskBody(entry));
    if (!created?.id) throw new ProviderError('google', 502, 'Google did not return the new entry.');
    return created.id;
  }

  async update(kind: ExternalKind, containerId: string, externalId: string, entry: CalendarEntry): Promise<void> {
    if (kind === 'event') {
      const event = await this.call<GoogleEvent>(
        'PATCH',
        `${CALENDAR_API}/calendars/${enc(containerId)}/events/${enc(externalId)}`,
        { ...googleEventBody(entry), status: 'confirmed' },
      );
      if (event?.status === 'cancelled') throw new ProviderError('google', 410, 'The event was deleted.');
      return;
    }
    const task = await this.call<GoogleTask>('PATCH', `${TASKS_API}/lists/${enc(containerId)}/tasks/${enc(externalId)}`, googleTaskBody(entry));
    if (task?.deleted) throw new ProviderError('google', 410, 'The task was deleted.');
  }

  async remove(kind: ExternalKind, containerId: string, externalId: string): Promise<void> {
    const url =
      kind === 'event'
        ? `${CALENDAR_API}/calendars/${enc(containerId)}/events/${enc(externalId)}`
        : `${TASKS_API}/lists/${enc(containerId)}/tasks/${enc(externalId)}`;
    try {
      await this.call<never>('DELETE', url);
    } catch (err) {
      if (err instanceof ProviderError && err.isGone) return;
      throw err;
    }
  }
}
