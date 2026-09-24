import { formatDateOnly, formatInstant } from './formatDate';
import { formatTime } from './formatTime';
import { DAY_LABELS } from './constants';
import type { PrivateAttendance, PrivateBookingStatus } from './types';

// Display helpers shared by every private-lesson page (public listing,
// booking wizard, parent, coach and admin views) — one wording per concept.
// Formatting only: every value comes from the backend.

/** "Tue, Oct 6, 2026, 4:30 PM" — a booking's startDate is a real instant. */
export function formatLessonTime(iso: string): string {
  return formatInstant(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "Tue, Oct 6" — the date half of a bookable lesson, for a date picker. */
export function formatLessonDay(iso: string): string {
  return formatInstant(iso, { weekday: 'short', year: undefined });
}

/** "4:30 PM" — the Central time half of a bookable lesson. */
export function formatLessonClock(iso: string): string {
  return formatInstant(iso, { hour: 'numeric', minute: '2-digit', month: undefined, day: undefined, year: undefined });
}

/** "Tuesdays · 4:30 PM · 30 min" — an availability rule. */
export function formatRuleSlot(rule: { dayOfWeek: number; startTime: string; durationMinutes: number }): string {
  return `${DAY_LABELS[rule.dayOfWeek]}s · ${formatTime(rule.startTime)} · ${rule.durationMinutes} min`;
}

/** "Oct 1, 2026 – Dec 31, 2026" — a rule's bookable range (calendar-day sentinels). */
export function formatRuleRange(rule: { startDate: string; endDate: string }): string {
  return `${formatDateOnly(rule.startDate)} – ${formatDateOnly(rule.endDate)}`;
}

/** The one label for where a booking stands. */
export function bookingStatusLabel(booking: { status: PrivateBookingStatus; attendance: PrivateAttendance }): string {
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.attendance === 'attended') return 'Attended';
  if (booking.attendance === 'missed') return 'Missed';
  return 'Booked';
}

/** "Dana Cole", or a fallback for a person deleted without a guard. */
export function personName(
  person: { firstName: string; lastName: string } | null | undefined,
  fallback: string
): string {
  return person ? `${person.firstName} ${person.lastName}` : fallback;
}

/** "10 sessions" / "1 session". */
export function sessionCount(count: number): string {
  return count === 1 ? '1 session' : `${count} sessions`;
}
