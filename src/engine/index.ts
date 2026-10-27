// Public surface of the scheduling & grading engine. Pure TS — runs on device and in vitest.
// Behaviour rules live in docs/ENGINE.md; export names and signatures are a fixed contract.
export * from './types';

export { addDays, compareDates, dayOfWeek, diffDays, eachDay, isISODate, maxDate, minDate, startOfWeek } from './dates';
export { computeImpact, effectiveWeight, isMajorKind } from './impact';
export { annotateItems, DEFAULT_EFFORT_MINUTES, estimateEffortMinutes, resolveReadingPages } from './effort';
export { buildPlan, rescheduleAfterMiss } from './planner';
export { computeDayLoads } from './load';
export { detectRedZones, stressLevel, weeklyStress } from './redzone';
export { triageForDate } from './triage';
export { focusLabel, focusQueue, pomodoroCycles } from './pomodoro';
export { courseGrade, DEFAULT_GRADE_SCALE, itemPercent, letterFor, requiredScore, simulateGrade } from './grades';
export { mergeTermEvents, synthesizeMasterCalendar } from './synthesis';
