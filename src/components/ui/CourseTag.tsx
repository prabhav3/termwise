import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Tag } from './Chip';

export interface CourseDotProps {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Bordered color dot. Decorative: pair it with the course name. */
export function CourseDot({ color, size = 12, style }: CourseDotProps) {
  const { colors, borders } = useTheme();
  return (
    <View
      accessible={false}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          borderWidth: borders.hairline,
          borderColor: colors.border,
        },
        style,
      ]}
    />
  );
}

export interface CourseTagProps {
  course: { code: string | null; title: string; color: string };
  style?: StyleProp<ViewStyle>;
}

/** Course code (or title) stamped on the course color. */
export function CourseTag({ course, style }: CourseTagProps) {
  return <Tag label={course.code ?? course.title} color={course.color} style={style} />;
}
