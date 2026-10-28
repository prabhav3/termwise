// Impact (how much an item matters to the grade) for lists and detail screens, computed with the
// engine's own rules from the cached rows — no full plan build needed.
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { useComponents, useCourses, useItems } from '@/data';
import { computeImpact, type ImpactInfo } from '@/engine';
import { useAuth } from '@/lib/auth';
import { plannerSettings, toEngineCourse, useToday } from '@/lib/planner';
import { useTheme } from '@/theme';

/** Impact per item id; null until courses, components, items and the profile are loaded. */
export function useImpactMap(): ReadonlyMap<string, ImpactInfo> | null {
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const courses = useCourses({ includeArchived: true });
  const components = useComponents();
  const items = useItems();

  return useMemo(() => {
    if (!profile || !courses.data || !components.data || !items.data) return null;
    const settings = plannerSettings(profile, today);
    const engineCourses = new Map(courses.data.map((course) => [course.id, toEngineCourse(course)]));
    const map = new Map<string, ImpactInfo>();
    for (const item of items.data) {
      map.set(
        item.id,
        computeImpact(item, { course: engineCourses.get(item.course_id), components: components.data, items: items.data, settings }),
      );
    }
    return map;
  }, [profile, today, courses.data, components.data, items.data]);
}

export type ImpactLevel = 1 | 2 | 3;

export function impactLevel(impact: ImpactInfo): ImpactLevel {
  if (impact.isHighImpact) return 3;
  return impact.score >= 35 ? 2 : 1;
}

const LEVEL_WORDS: Record<ImpactLevel, string> = { 1: 'Low impact', 2: 'Medium impact', 3: 'High impact' };

export function impactWords(impact: ImpactInfo): string {
  return LEVEL_WORDS[impactLevel(impact)];
}

/** One to three stars; the shape (filled vs outline) carries the level, never color alone. */
export function ImpactStars({ impact, size = 14 }: { impact: ImpactInfo; size?: number }) {
  const { colors } = useTheme();
  const level = impactLevel(impact);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={LEVEL_WORDS[level]} style={styles.row}>
      {[1, 2, 3].map((n) => (
        <Icon
          key={n}
          name={n <= level ? 'star.fill' : 'star'}
          fallback={n <= level ? '★' : '☆'}
          size={size}
          color={n <= level ? colors.ink : colors.inkMuted}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 1 },
});
