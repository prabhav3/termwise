// Central TanStack Query keys. Each table has one root key; invalidating the root refreshes
// every query of that table. The cache is cleared on sign-out, so keys need no user id
// (except the profile, which the auth guard reads while users switch).

export const queryKeys = {
  profile: (userId: string) => ['profile', userId] as const,
  terms: () => ['terms'] as const,
  courses: () => ['courses'] as const,
  components: () => ['components'] as const,
  items: () => ['items'] as const,
  textbooks: () => ['textbooks'] as const,
  termEvents: () => ['termEvents'] as const,
  uploads: () => ['uploads'] as const,
  upload: (id: string) => ['uploads', 'detail', id] as const,
  planBlocks: () => ['planBlocks'] as const,
  focusSessions: () => ['focusSessions'] as const,
  calendarConnections: () => ['calendarConnections'] as const,
  eventLinks: () => ['eventLinks'] as const,
  eventLinksFor: (connectionId: string) => ['eventLinks', connectionId] as const,
  lmsConnections: () => ['lmsConnections'] as const,
  lmsCourses: () => ['lmsCourses'] as const,
  /** Live course list from Canvas (function call), kept under the lmsCourses root. */
  canvasCourses: (connectionId: string) => ['lmsCourses', 'canvas', connectionId] as const,
  discrepancies: () => ['discrepancies'] as const,
  shares: () => ['shares'] as const,
  shareForCourse: (courseId: string) => ['shares', 'course', courseId] as const,
  sharedTimeline: (slug: string) => ['shares', 'public', slug] as const,
} as const;

/** Every table whose rows feed the planner (a change to any of them should trigger a replan). */
export const planInputKeys = [
  queryKeys.courses(),
  queryKeys.components(),
  queryKeys.items(),
  queryKeys.textbooks(),
  queryKeys.termEvents(),
] as const;
