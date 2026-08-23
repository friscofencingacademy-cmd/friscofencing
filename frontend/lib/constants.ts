import type { Role } from './types';

// Shared cross-page constants. `DAY_LABELS` mirrors the backend's
// `Date.getDay()` convention (0=Sunday ... 6=Saturday) used by
// GroupClassSchedule/PrivateClassSchedule's `dayOfWeek` field — index into
// this array, never re-derive the label list per component.
export const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// Where a signed-in user lands — right after `/login`, and when visiting
// `/` while already signed in. `student` has no dedicated dashboard (the
// student portal is explicitly deferred, see CLAUDE.md), so it points
// back at `/` — the one role this map does NOT redirect away from `/`.
export const ROLE_LANDING_PATH: Record<Role, string> = {
  admin: '/admin/dashboard',
  superadmin: '/admin/dashboard',
  coach: '/coach/schedules',
  parent: '/parent/dashboard',
  student: '/',
};
