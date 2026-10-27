// Effort estimation (docs/ENGINE.md "Effort") and item annotation.
import { roundTo5 } from './format';
import { impactFromWeight, weightResolver } from './impact';
import { resolveReading } from './pages';
import type { AnnotatedItem, EngineItem, EngineTextbook, ItemKind, PlanInput, PlannerSettings } from './types';

export const DEFAULT_EFFORT_MINUTES: Record<ItemKind, number> = {
  exam: 360,
  quiz: 60,
  paper: 600,
  project: 720,
  homework: 90,
  reading: 60,
  presentation: 240,
  lab: 120,
  discussion: 30,
  other: 60,
};

const MIN_READING_MINUTES = 10;

export function resolveReadingPages(item: EngineItem, textbooks: EngineTextbook[], settings: PlannerSettings): number | null {
  return resolveReading(item, textbooks, settings)?.total ?? null;
}

export function pagesPerHour(settings: PlannerSettings): number {
  return Math.max(1, settings.reading_pages_per_hour);
}

/** Minutes to read `pages` at the student's reading speed (no minimum applied). */
export function readingMinutes(pages: number, settings: PlannerSettings): number {
  return Math.ceil((pages / pagesPerHour(settings)) * 60 - 1e-9);
}

/**
 * Weight scaling for default effort, piecewise linear so it has no jumps:
 * ×0.6 under 5%, rising to ×1 at 10%, flat ×1 through 20%, rising to ×1.5 at 30% and above.
 */
function weightScale(weight: number | null): number {
  if (weight == null) return 1;
  if (weight < 5) return 0.6;
  if (weight < 10) return 0.6 + ((weight - 5) / 5) * 0.4;
  if (weight <= 20) return 1;
  if (weight < 30) return 1 + ((weight - 20) / 10) * 0.5;
  return 1.5;
}

export function estimateEffortMinutes(
  item: EngineItem,
  pages: number | null,
  weight: number | null,
  settings: PlannerSettings,
): number {
  if (item.kind === 'reading' && pages != null && pages > 0) {
    return Math.max(MIN_READING_MINUTES, readingMinutes(pages, settings));
  }
  if (item.estimated_minutes != null && item.estimated_minutes > 0) return Math.round(item.estimated_minutes);
  return Math.max(5, roundTo5(DEFAULT_EFFORT_MINUTES[item.kind] * weightScale(weight)));
}

export function annotateItems(input: PlanInput): AnnotatedItem[] {
  const resolveWeight = weightResolver(input.components, input.items);
  const courses = new Map(input.courses.map((c) => [c.id, c]));
  return input.items.map((item) => {
    const weight = resolveWeight(item);
    const impact = impactFromWeight(item, weight, courses.get(item.course_id), input.settings);
    // AnnotatedItem.resolvedPages is reading-only by contract; other kinds plan by minutes.
    const resolvedPages = item.kind === 'reading' ? resolveReadingPages(item, input.textbooks, input.settings) : null;
    const effortMinutes = estimateEffortMinutes(item, resolvedPages, weight, input.settings);
    return { ...item, impact, resolvedPages, effortMinutes };
  });
}
