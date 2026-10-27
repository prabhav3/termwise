import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannerSettings, PlanResult, TriageAction } from '@/engine';

// The digest builder is pure; stub the native modules it sits next to.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
}));
const triageForDate = vi.fn<(plan: PlanResult, courses: unknown, settings: PlannerSettings, date: string) => TriageAction[]>();
vi.mock('@/engine', () => ({
  triageForDate: (plan: PlanResult, courses: unknown, settings: PlannerSettings, date: string) =>
    triageForDate(plan, courses, settings, date),
}));

const { buildTriageDigests, triageBody, triageTitle } = await import('./notifications');

function action(title: string, reason: TriageAction['reason'] = 'planned_today'): TriageAction {
  return {
    key: `triage:${title}`,
    item_id: title,
    block_key: null,
    course_id: 'c1',
    title,
    subtitle: '',
    minutes: 30,
    priority: 50,
    reason,
  };
}

const plan: PlanResult = { blocks: [], days: [], overflow: [], annotated: [] };
const settings: PlannerSettings = {
  today: '2026-10-27',
  study_days: [0, 1, 2, 3, 4, 5, 6],
  daily_capacity_minutes: 180,
  reading_pages_per_hour: 20,
  default_pages_per_chapter: 25,
  high_impact_threshold: 15,
  blackout_dates: [],
};
const profile = { timezone: 'America/New_York', triage_notification_time: '07:30:00' };

describe('triage digest text', () => {
  it('numbers the steps and joins them with a dot', () => {
    expect(triageBody([action('Read pp. 101–126'), action('Outline HIST paper'), action('Psych Quiz 1 review')])).toBe(
      '1. Read pp. 101–126 · 2. Outline HIST paper · 3. Psych Quiz 1 review',
    );
  });

  it('shortens long steps so three fit a banner', () => {
    const body = triageBody([action('Milestone check-in: full draft for the Research Paper on Cognitive Load')]);
    expect(body.length).toBeLessThanOrEqual(3 + 44);
    expect(body.endsWith('…')).toBe(true);
  });

  it('titles by count', () => {
    expect(triageTitle(1)).toBe("Today's one thing");
    expect(triageTitle(3)).toBe("Today's top 3");
  });
});

describe('buildTriageDigests', () => {
  beforeEach(() => {
    triageForDate.mockReset();
  });

  it('schedules the next mornings in the student time zone and skips empty days', () => {
    triageForDate.mockImplementation((_plan, _courses, _settings, date) => {
      if (date === '2026-10-29') return [];
      if (date === '2026-10-30') return [action('Finish lab report', 'overdue'), action('Read ch. 5')];
      return [action('A'), action('B'), action('C'), action('D')];
    });

    // 08:00 EDT on Oct 27: this morning's 07:30 has already passed.
    const digests = buildTriageDigests({ plan, courses: [], settings, profile, now: new Date('2026-10-27T12:00:00Z') });

    expect(digests.map((digest) => digest.date)).toEqual([
      '2026-10-28',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    // EDT (UTC-4) before Nov 1, EST (UTC-5) from Nov 1.
    expect(digests[0].fireAt.toISOString()).toBe('2026-10-28T11:30:00.000Z');
    expect(digests[3].fireAt.toISOString()).toBe('2026-11-01T12:30:00.000Z');
    expect(digests[0]).toMatchObject({ title: "Today's top 3", body: '1. A · 2. B · 3. C' });
    // Future days leave out overdue catch-ups.
    expect(digests[1]).toMatchObject({ title: "Today's one thing", body: '1. Read ch. 5' });
    expect(new Set(digests.map((digest) => digest.identifier)).size).toBe(digests.length);
  });

  it("includes today while this morning's time is still ahead, overdue items too", () => {
    triageForDate.mockImplementation(() => [action('Finish lab report', 'overdue')]);
    const digests = buildTriageDigests({
      plan,
      courses: [],
      settings,
      profile,
      now: new Date('2026-10-27T10:00:00Z'), // 06:00 EDT
      days: 1,
    });
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ date: '2026-10-27', body: '1. Finish lab report' });
  });
});
