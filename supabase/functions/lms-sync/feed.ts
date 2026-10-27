// Fetching and reading a private LMS iCal feed (Blackboard, Moodle, Brightspace, any LMS).
import { inferCanvasKind } from '../_shared/canvas-client.ts';
import { HttpError } from '../_shared/http.ts';
import { cleanFeedTitle, feedCourseLabel, parseIcs, type ParsedIcs, toLocal, UNLABELED_FEED_COURSE } from '../_shared/ics.ts';
import { safeFetch, SafeFetchError } from '../_shared/safe-fetch.ts';

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const FEED_TIMEOUT_MS = 15_000;

export interface FeedEvent {
  /** Stable id for dedupe keys: the event UID, else title + date. */
  externalId: string;
  label: string;
  title: string;
  kind: string;
  date: string;
  time: string | null;
}

/** "webcal://…" and "http://…" (what LMSs hand out) become https; anything else is validated by safeFetch. */
export function normalizeFeedUrl(input: string): string {
  const raw = input.trim();
  if (/^webcals?:\/\//i.test(raw)) return `https://${raw.replace(/^webcals?:\/\//i, '')}`;
  if (/^http:\/\//i.test(raw)) return `https://${raw.slice(7)}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

export type FeedFailure = 'revoked' | 'unreachable' | 'not_calendar';

export class FeedError extends Error {
  constructor(
    readonly failure: FeedFailure,
    message: string,
  ) {
    super(message);
    this.name = 'FeedError';
  }
}

/** Downloads and parses the feed. Throws HttpError for unsafe URLs and FeedError otherwise. */
export async function fetchFeed(feedUrl: string): Promise<ParsedIcs> {
  let text: string;
  try {
    const response = await safeFetch(feedUrl, {
      headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
      maxBytes: MAX_FEED_BYTES,
      timeoutMs: FEED_TIMEOUT_MS,
    });
    if ([401, 403, 404, 410].includes(response.status)) {
      throw new FeedError('revoked', 'Your LMS no longer shares this calendar link. Copy a fresh link from your LMS and reconnect.');
    }
    if (!response.ok) throw new FeedError('unreachable', `Your LMS answered with an error (${response.status}). Try again later.`);
    text = response.text();
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === 'unsafe_url') throw new HttpError('bad_request', err.message);
      if (err.code === 'too_large') throw new HttpError('too_large', 'That calendar feed is too large to read.');
      throw new FeedError('unreachable', err.code === 'timeout' ? 'Your LMS took too long to answer.' : "We couldn't reach your LMS.");
    }
    throw err;
  }
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2048))) {
    throw new FeedError('not_calendar', "That link isn't a calendar feed. In your LMS, look for “Export calendar” or “iCal / .ics link”.");
  }
  return parseIcs(text);
}

/** Deadline-like events in the student's zone, with their course label. */
export function feedEvents(feed: ParsedIcs, timeZone: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  const seen = new Set<string>();
  for (const event of feed.events) {
    if (!event.start || event.status === 'CANCELLED') continue;
    const { label, title: rawTitle } = feedCourseLabel(event);
    const { title, isOpening } = cleanFeedTitle(rawTitle);
    if (isOpening || !title) continue;
    const local = toLocal(event.start, timeZone);
    const externalId = (event.uid?.trim() || `${label ?? ''}|${title}|${local.date}`).slice(0, 200);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    out.push({
      externalId,
      label: label?.slice(0, 120) || UNLABELED_FEED_COURSE,
      title: title.slice(0, 300),
      kind: inferCanvasKind({ name: title, submission_types: [] }),
      date: local.date,
      time: local.time,
    });
  }
  return out;
}

export function feedLabels(events: FeedEvent[]): string[] {
  return [...new Set(events.map((e) => e.label))].sort((a, b) => a.localeCompare(b));
}
