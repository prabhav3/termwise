// HTML for the share-link preview, in the app's neo-brutalist style (docs/DESIGN.md): cream
// paper, 3px ink borders, hard 4px shadows, heavy type, and a dark variant. Every value from the
// snapshot is escaped; the page loads nothing external.
import { formatDateLabel, formatTimeLabel, ITEM_KIND_LABELS, toHHMM } from '../_shared/calendar-model.ts';

export interface PreviewItem {
  title: string;
  kind: string;
  due_date: string | null;
  due_time: string | null;
}

export interface PreviewData {
  slug: string;
  course: { title: string; code: string | null; section: string | null; instructor: string | null; color: string | null };
  counts: { exams: number; papers: number; readings: number };
  upcoming: PreviewItem[];
  importCount: number;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const STYLES = `
:root{--bg:#FFF4DE;--surface:#FFFFFF;--alt:#FFE9B8;--ink:#111111;--muted:#4A4A4A;--border:#111111;--shadow:#111111;--primary:#5B5BD6;--on-primary:#FFFFFF;--yellow:#FFD23F;--pink:#FF6B9D;--green:#3DDC97}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--surface:#1F1F1F;--alt:#2A2A2A;--ink:#F4F1EA;--muted:#B9B4A9;--border:#F4F1EA;--shadow:#000000;--primary:#8B8BFF;--on-primary:#111111}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:500 16px/22px "Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px 40px}
.display{font-family:"Archivo Black","Arial Black",Impact,ui-sans-serif,system-ui,sans-serif;font-weight:900;letter-spacing:-.01em}
.eyebrow{display:inline-block;font:700 12px/16px ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;background:var(--yellow);color:#111;border:2px solid var(--border);padding:4px 8px;margin-bottom:16px}
.card{background:var(--surface);border:3px solid var(--border);border-radius:12px;box-shadow:4px 4px 0 0 var(--shadow);padding:16px;margin-bottom:16px}
.course{border-left-width:12px}
h1{font-size:28px;line-height:32px;margin:0 0 8px;overflow-wrap:anywhere}
h2{font-size:18px;line-height:22px;margin:0 0 12px}
.meta{color:var(--muted);font-size:14px;line-height:20px;margin:0}
.tag{display:inline-block;font-weight:700;font-size:12px;line-height:16px;border:2px solid var(--border);padding:2px 6px;margin-right:6px;background:var(--alt)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.stat{background:var(--surface);border:3px solid var(--border);border-radius:12px;box-shadow:4px 4px 0 0 var(--shadow);padding:12px;text-align:center}
.stat b{display:block;font-size:34px;line-height:38px}
.stat span{font-size:12px;line-height:16px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.stat.exams{background:var(--pink);color:#111}.stat.papers{background:var(--yellow);color:#111}.stat.readings{background:var(--green);color:#111}
ol{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:2px solid var(--border)}
li:first-child{border-top:0;padding-top:0}
.date{flex:0 0 auto;min-width:92px;font-weight:700;font-size:14px;line-height:20px;border:2px solid var(--border);background:var(--alt);padding:2px 6px;text-align:center}
.what{min-width:0;overflow-wrap:anywhere}
.what small{display:block;color:var(--muted);font-size:12px;line-height:16px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.empty{color:var(--muted);margin:0}
.button{display:block;text-align:center;text-decoration:none;background:var(--primary);color:var(--on-primary);border:3px solid var(--border);border-radius:8px;box-shadow:4px 4px 0 0 var(--shadow);padding:14px 16px;font-size:18px;line-height:22px;margin:24px 0 12px}
.button:active{transform:translate(4px,4px);box-shadow:none}
.note{color:var(--muted);font-size:14px;line-height:20px;text-align:center;margin:0}
@media (prefers-reduced-motion:reduce){.button:active{transform:none}}
`;

function htmlDocument(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:site_name" content="Termwise">
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function itemLine(item: PreviewItem): string {
  const date = item.due_date ? formatDateLabel(item.due_date) : 'TBD';
  const time = toHHMM(item.due_time);
  const kind = ITEM_KIND_LABELS[item.kind] ?? 'Deadline';
  return `<li><span class="date">${escapeHtml(date)}</span><span class="what">${escapeHtml(item.title)}<small>${escapeHtml(
    time ? `${kind} · ${formatTimeLabel(time)}` : kind,
  )}</small></span></li>`;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function renderPreview(data: PreviewData): string {
  const { course, counts } = data;
  const heading = course.code ? `${course.code}: ${course.title}` : course.title;
  const accent = course.color && HEX_COLOR.test(course.color) ? course.color : '#5B5BD6';
  const meta = [course.section ? `Section ${course.section}` : null, course.instructor].filter((v): v is string => Boolean(v));
  const description = `${counts.exams} ${plural(counts.exams, 'exam', 'exams')}, ${counts.papers} ${plural(counts.papers, 'paper', 'papers')}, ${counts.readings} ${plural(counts.readings, 'reading', 'readings')} — open the timeline in Termwise.`;
  const upcoming =
    data.upcoming.length > 0
      ? `<ol>${data.upcoming.map(itemLine).join('')}</ol>`
      : '<p class="empty">No upcoming deadlines on this timeline.</p>';
  const appUrl = `termwise://share/${encodeURIComponent(data.slug)}`;
  const imported =
    data.importCount > 0 ? `${data.importCount} ${plural(data.importCount, 'classmate has', 'classmates have')} imported this. ` : '';

  const body = `<span class="eyebrow">Termwise · Shared timeline</span>
<section class="card course" style="border-left-color:${accent}">
<h1 class="display">${escapeHtml(heading)}</h1>
${meta.length > 0 ? `<p class="meta">${escapeHtml(meta.join(' · '))}</p>` : ''}
</section>
<section class="stats" aria-label="What's in this course">
<div class="stat exams"><b class="display">${counts.exams}</b><span>${plural(counts.exams, 'Exam', 'Exams')}</span></div>
<div class="stat papers"><b class="display">${counts.papers}</b><span>${plural(counts.papers, 'Paper', 'Papers')}</span></div>
<div class="stat readings"><b class="display">${counts.readings}</b><span>${plural(counts.readings, 'Reading', 'Readings')}</span></div>
</section>
<section class="card">
<h2 class="display">Next up</h2>
${upcoming}
</section>
<a class="button display" href="${escapeHtml(appUrl)}">Open in Termwise</a>
<p class="note">${escapeHtml(imported)}Importing copies the dates and weights into your own plan. Grades and notes are never shared.</p>`;
  return htmlDocument(`${heading} · Termwise`, description, body);
}

export function renderNotFound(): string {
  const body = `<span class="eyebrow">Termwise</span>
<section class="card">
<h1 class="display">This link isn’t available</h1>
<p class="meta">The person who shared this course may have turned the link off, or it was copied incompletely. Ask them to share it again from Termwise.</p>
</section>`;
  return htmlDocument('Share link not found · Termwise', 'This Termwise share link is no longer available.', body);
}

export function renderUnavailable(): string {
  const body = `<span class="eyebrow">Termwise</span>
<section class="card">
<h1 class="display">Hang on a second</h1>
<p class="meta">We couldn’t load this shared course right now. Refresh the page in a moment.</p>
</section>`;
  return htmlDocument('Temporarily unavailable · Termwise', 'This Termwise share link is temporarily unavailable.', body);
}
