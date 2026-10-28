// Current grade, how much of it is in, the target, and the projected final range.
// Shared by the Grades tab cards and the top of the grade tracker.
import { View } from 'react-native';

import { NBText, ProgressBar } from '@/components/ui';
import type { CourseGrade, EngineCourse } from '@/engine';
import { useTheme } from '@/theme';

import { GradeHeadline } from './GradeHeadline';
import { formatGrade, formatWeight, gradedShare, gradedShareLabel, letterForCourse } from './model';
import { RangeBar } from './RangeBar';

export interface GradeOverviewProps {
  course: EngineCourse;
  grade: CourseGrade;
  size?: 'regular' | 'hero';
}

export function targetSummary(course: EngineCourse): string {
  if (course.target_percent === null) return 'No target set';
  const target = Number(course.target_percent);
  const letter = letterForCourse(target, course);
  return `Target ${formatWeight(target)}${letter ? ` · ${letter}` : ''}`;
}

/** One sentence for VoiceOver on a pressable card that hides its children. */
export function gradeOverviewSpoken(course: EngineCourse, grade: CourseGrade): string {
  const parts = [
    grade.percent === null
      ? 'No scores yet'
      : `Current grade ${formatGrade(grade.percent).replace('%', ' percent')}${grade.letter ? `, ${grade.letter}` : ''}`,
    gradedShareLabel(grade),
    targetSummary(course),
  ];
  if (grade.gradedWeight > 0 && grade.projectedMin !== null && grade.projectedMax !== null) {
    parts.push(
      `Final lands between ${formatGrade(grade.projectedMin).replace('%', ' percent')} and ${formatGrade(grade.projectedMax).replace('%', ' percent')}`,
    );
  }
  return parts.join('. ');
}

export function GradeOverview({ course, grade, size = 'regular' }: GradeOverviewProps) {
  const { spacing } = useTheme();
  const hasScores = grade.percent !== null;
  const showRange = grade.gradedWeight > 0 && grade.projectedMin !== null && grade.projectedMax !== null;
  const target = course.target_percent !== null ? Number(course.target_percent) : null;

  return (
    <View style={{ gap: spacing.md }}>
      {hasScores ? (
        <GradeHeadline
          caption="Current grade"
          percent={grade.percent}
          letter={grade.letter}
          letterColor={course.color}
          size={size}
        />
      ) : (
        <View style={{ gap: spacing.xs }}>
          <NBText variant="h3">No scores yet</NBText>
          <NBText variant="small" color="muted">
            Scores from Canvas land here on their own, or add them yourself in a few taps.
          </NBText>
        </View>
      )}

      {grade.totalWeight > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <ProgressBar value={gradedShare(grade)} label="Share of the grade that's in" color="primary" height={14} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
            <NBText variant="smallBold" dense>
              {gradedShareLabel(grade)}
            </NBText>
            <NBText variant="small" color="muted" dense>
              {targetSummary(course)}
            </NBText>
          </View>
        </View>
      ) : (
        <NBText variant="small" color="muted">
          {`${gradedShareLabel(grade)} · ${targetSummary(course)}`}
        </NBText>
      )}

      {showRange && grade.projectedMin !== null && grade.projectedMax !== null ? (
        <RangeBar
          min={grade.projectedMin}
          max={grade.projectedMax}
          target={target}
          targetLabel={target !== null ? letterForCourse(target, course) : null}
        />
      ) : null}
    </View>
  );
}
