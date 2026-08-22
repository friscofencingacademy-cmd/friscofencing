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
