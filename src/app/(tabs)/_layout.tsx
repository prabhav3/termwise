import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { colors, fonts } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.primary}
      iconColor={{ default: colors.inkMuted, selected: colors.primary }}
      labelStyle={{
        default: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
        selected: { fontFamily: fonts.bodyBold, color: colors.primary },
      }}
      // iOS 18 and earlier only; iOS 26+ derives the bar from the content behind it.
      backgroundColor={colors.surface}
      shadowColor={colors.border}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} md="today" />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar.badge.clock' }} md="calendar_month" />
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="courses" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Icon sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }} md="school" />
        <NativeTabs.Trigger.Label>Courses</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="grades" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="bar_chart" />
        <NativeTabs.Trigger.Label>Grades</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" contentStyle={{ backgroundColor: colors.bg }}>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
