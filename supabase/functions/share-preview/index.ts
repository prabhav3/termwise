// share-preview (auth: none, verify_jwt = false) — GET ?slug=<slug> -> HTML preview of a shared
// course timeline (title/code, counts of exams/papers/readings, the next 5 dated items) with an
// "Open in Termwise" button to termwise://share/<slug>. Reads through the public
// get_shared_timeline RPC with the anonymous client, so revoked links and grades stay hidden.
// Unknown or revoked slugs get a friendly 404 page.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import { todayInZone } from '../_shared/calendar-model.ts';
import { type PreviewData, type PreviewItem, renderNotFound, renderPreview, renderUnavailable } from './page.ts';

const SLUG_RE = /^[A-Za-z0-9_-]{4,64}$/;
const UPCOMING_LIMIT = 5;
/** The earliest zone on Earth: a deadline that is still today anywhere stays listed. */
const EARLIEST_ZONE = 'Etc/GMT+12';

interface SharedTimeline {
  slug: string;
  import_count: number;
  snapshot: {
    course?: { title?: string; code?: string | null; section?: string | null; instructor?: string | null; color?: string | null };
    items?: Array<Partial<PreviewItem>>;
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function html(status: number, body: string, cache: string): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': cache } });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toPreview(timeline: SharedTimeline, today: string): PreviewData {
  const course = timeline.snapshot.course ?? {};
  const items: PreviewItem[] = (timeline.snapshot.items ?? []).flatMap((item) => {
    const title = text(item.title);
    return title ? [{ title, kind: text(item.kind) ?? 'other', due_date: text(item.due_date), due_time: text(item.due_time) }] : [];
  });
  const count = (kind: string) => items.filter((i) => i.kind === kind).length;
  const upcoming = items
    .filter((i): i is PreviewItem & { due_date: string } => i.due_date !== null && i.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.due_time ?? '24').localeCompare(b.due_time ?? '24'))
    .slice(0, UPCOMING_LIMIT);
  return {
    slug: timeline.slug,
    course: {
      title: text(course.title) ?? 'Shared course',
      code: text(course.code),
      section: text(course.section),
      instructor: text(course.instructor),
      color: text(course.color),
    },
    counts: { exams: count('exam'), papers: count('paper'), readings: count('reading') },
    upcoming,
    importCount: Number.isFinite(timeline.import_count) ? timeline.import_count : 0,
  };
}

async function sharePreview(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return html(405, renderNotFound(), 'no-store');
  const slug = new URL(req.url).searchParams.get('slug')?.trim() ?? '';
  if (!SLUG_RE.test(slug)) return html(404, renderNotFound(), 'public, max-age=60');

  const { data, error } = await ctx.supabase.rpc('get_shared_timeline', { p_slug: slug });
  if (error) {
    console.error(`share-preview: lookup failed (${error.code})`);
    return html(503, renderUnavailable(), 'no-store');
  }
  const timeline = data as SharedTimeline | null;
  if (!timeline?.snapshot) return html(404, renderNotFound(), 'public, max-age=60');
  return html(200, renderPreview(toPreview(timeline, todayInZone(EARLIEST_ZONE))), 'public, max-age=300');
}

export default { fetch: withSupabase({ auth: 'none' }, sharePreview) };
