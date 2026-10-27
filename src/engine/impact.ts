// Grade weight and impact scoring (docs/ENGINE.md "Effective weight" and "Impact score").
import { clamp, courseLabel, formatPercent } from './format';
import type { EngineComponent, EngineCourse, EngineItem, ImpactInfo, ItemKind, PlannerSettings } from './types';

/** exam, paper, project, presentation */
export function isMajorKind(kind: ItemKind): boolean {
  return kind === 'exam' || kind === 'paper' || kind === 'project' || kind === 'presentation';
}

/** "Major" in the spec's vocabulary: a major kind or flagged `is_major`. */
export function isMajorItem(item: Pick<EngineItem, 'kind' | 'is_major'>): boolean {
  return isMajorKind(item.kind) || item.is_major;
}

/** Component weight split across its N graded slots (N reduced by drop_lowest while N stays >= 1). */
function componentShare(component: EngineComponent, linkedCount: number): number | null {
  let slots = Math.max(component.expected_count ?? 0, linkedCount);
  if (slots <= 0) return null;
  if (component.drop_lowest > 0 && slots - component.drop_lowest >= 1) slots -= component.drop_lowest;
  return Math.max(0, component.weight) / slots;
}

export function effectiveWeight(item: EngineItem, components: EngineComponent[], allItems: EngineItem[]): number | null {
  if (item.weight_override != null) return Math.max(0, item.weight_override);
  if (item.component_id == null) return null;
  const component = components.find((c) => c.id === item.component_id);
  if (!component) return null;
  const linked = new Set<string>([item.id]);
  for (const other of allItems) if (other.component_id === component.id) linked.add(other.id);
  return componentShare(component, linked.size);
}

/**
 * Precomputed lookup for annotating many items at once (avoids the O(n²) scan of
 * `effectiveWeight`). Produces identical results.
 */
export function weightResolver(components: EngineComponent[], items: EngineItem[]): (item: EngineItem) => number | null {
  const byId = new Map(components.map((c) => [c.id, c]));
  const linked = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.component_id == null) continue;
    const set = linked.get(item.component_id) ?? new Set<string>();
    set.add(item.id);
    linked.set(item.component_id, set);
  }
  return (item) => {
    if (item.weight_override != null) return Math.max(0, item.weight_override);
    if (item.component_id == null) return null;
    const component = byId.get(item.component_id);
    if (!component) return null;
    const ids = linked.get(component.id);
    const count = (ids?.size ?? 0) + (ids?.has(item.id) ? 0 : 1);
    return componentShare(component, count);
  };
}

// ---- impact score ------------------------------------------------------------------------
// score = (weightPoints + kindBonus) × creditsMultiplier, rounded and clamped to 0–100.
//   weightPoints: 2.4 points per percent of the course grade (25% ≈ 60 points), capped at 85.
//                 Unknown weight: 30 for major work, 8 otherwise.
//   kindBonus:    exam/paper/project +15, presentation/quiz +5.
//   multiplier:   credits ÷ 3 clamped to 0.67–1.5 (unknown credits = 1).
//   high_impact_override = true lifts the score to at least 60; false caps it at 30.
const POINTS_PER_PERCENT = 2.4;
const WEIGHT_POINTS_CAP = 85;
const UNKNOWN_MAJOR_POINTS = 30;
const UNKNOWN_MINOR_POINTS = 8;
const KIND_BONUS: Partial<Record<ItemKind, number>> = { exam: 15, paper: 15, project: 15, presentation: 5, quiz: 5 };

function kindReason(item: EngineItem): string | null {
  const title = item.title.toLowerCase();
  switch (item.kind) {
    case 'exam':
      if (/\bfinal\b/.test(title)) return 'Final exam';
      if (/\bmid-?term\b/.test(title)) return 'Midterm exam';
      return 'Exam';
    case 'paper':
      return 'Paper';
    case 'project':
      return 'Project';
    case 'presentation':
      return 'Presentation';
    case 'quiz':
      return 'Quiz';
    default:
      return null;
  }
}

export function computeImpact(
  item: EngineItem,
  ctx: { course: EngineCourse | undefined; components: EngineComponent[]; items: EngineItem[]; settings: PlannerSettings },
): ImpactInfo {
  return impactFromWeight(item, effectiveWeight(item, ctx.components, ctx.items), ctx.course, ctx.settings);
}

export function impactFromWeight(
  item: EngineItem,
  weight: number | null,
  course: EngineCourse | undefined,
  settings: PlannerSettings,
): ImpactInfo {
  const threshold = settings.high_impact_threshold;
  const major = isMajorItem(item);
  const bigKind = item.kind === 'exam' || item.kind === 'paper' || item.kind === 'project';

  let isHighImpact: boolean;
  if (item.high_impact_override != null) isHighImpact = item.high_impact_override;
  else if (weight != null && weight >= threshold) isHighImpact = true;
  else if (weight != null && bigKind && weight >= threshold / 2) isHighImpact = true;
  // Unknown weight: trust the "major" vocabulary (major kind or is_major flag).
  else isHighImpact = weight == null && major;

  const reasons: string[] = [];
  const label = courseLabel(course);
  if (weight != null) reasons.push(`Worth ${formatPercent(weight)} of ${label}`);
  else if (major) reasons.push('Grade weight not listed — treated as major');

  const kindText = kindReason(item);
  if (kindText) reasons.push(kindText);

  const credits = course?.credits != null && course.credits > 0 ? course.credits : null;
  const multiplier = credits == null ? 1 : clamp(credits / 3, 0.67, 1.5);
  if (credits != null && credits >= 4) reasons.push(`${credits}-credit course`);
  else if (credits != null && credits <= 2) reasons.push(`Lighter ${credits}-credit course`);

  const weightPoints =
    weight != null ? Math.min(WEIGHT_POINTS_CAP, weight * POINTS_PER_PERCENT) : major ? UNKNOWN_MAJOR_POINTS : UNKNOWN_MINOR_POINTS;
  let score = (weightPoints + (KIND_BONUS[item.kind] ?? 0)) * multiplier;
  if (item.high_impact_override === true) {
    score = Math.max(score, 60);
    reasons.push('Marked high impact');
  } else if (item.high_impact_override === false) {
    score = Math.min(score, 30);
    reasons.push('Marked low impact');
  }

  return { weight, score: clamp(Math.round(score), 0, 100), isHighImpact, reasons };
}
