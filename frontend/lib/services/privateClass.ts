import api from '../api';
import type {
  CoachPrivateAvailabilityRule,
  PrivateAttendanceResult,
  PrivateAvailabilityRemovalOutcome,
  PrivateAvailableDate,
  PrivateBookingResult,
  PrivateCancelResult,
  PrivatePurchaseEntry,
  PrivatePurchaseQuote,
  PublicPrivateLessons,
  PublishPrivateAvailabilityInput,
} from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// Private lessons (docs/decisions/011-private-per-session-booking.md). One
// client function per endpoint: queries throw (pair with useLoadState),
// mutations resolve to a MutationResult. Mutations used by more than one role
// (publish/remove availability, cancel a booking, mark attendance) live here
// once; role-specific list queries live in privateClassCoach.ts and
// privateClassAdmin.ts.

// ── Public (no auth) ───────────────────────────────────────────────────────

export async function fetchPublicPrivateLessons(): Promise<PublicPrivateLessons> {
  const res = await api.get<PublicPrivateLessons>('/private-class-schedules/public');
  return res.data;
}

export async function fetchPrivateAvailableDates(scheduleId: string): Promise<PrivateAvailableDate[]> {
  const res = await api.get<{ dates: PrivateAvailableDate[] }>(
    `/private-class-schedules/${scheduleId}/available-dates`
  );
  return res.data.dates;
}

// ── Parent ──────────────────────────────────────────────────────────────────

export async function fetchPrivatePurchaseQuote(studentId: string, scheduleId: string): Promise<PrivatePurchaseQuote> {
  const res = await api.get<PrivatePurchaseQuote>('/private-class-enrollments/quote', {
    params: { studentId, scheduleId },
  });
  return res.data;
}

export async function fetchMyPrivatePurchases(): Promise<PrivatePurchaseEntry[]> {
  const res = await api.get<{ enrollments: PrivatePurchaseEntry[] }>('/private-class-enrollments/mine');
  return res.data.enrollments;
}

// Buy a single session (no `packId`) or one of the coach's packs, and book
// the first lesson on `day` ('YYYY-MM-DD'). The request names a choice,
// never a price; a pack that is no longer offered is a 409.
export async function purchasePrivateLessons(data: {
  studentId: string;
  scheduleId: string;
  day: string;
  packId?: string;
}): Promise<MutationResult<PrivateBookingResult>> {
  try {
    const res = await api.post<PrivateBookingResult>('/private-class-enrollments', data);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Payment or booking failed. Please try again.') };
  }
}

// Book `day` with an already-paid session.
export async function bookPrivateLessonWithCredit(data: {
  studentId: string;
  scheduleId: string;
  day: string;
}): Promise<MutationResult<PrivateBookingResult>> {
  try {
    const res = await api.post<PrivateBookingResult>('/private-class-sessions', data);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Booking failed. Please try again.') };
  }
}

// ── Shared by several roles ────────────────────────────────────────────────

// Parent (own), coach (own) or admin — the backend decides who may cancel
// when; listings expose it as `canCancel`.
export async function cancelPrivateBooking(sessionId: string): Promise<MutationResult<PrivateCancelResult>> {
  try {
    const res = await api.post<PrivateCancelResult>(`/private-class-sessions/${sessionId}/cancel`);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to cancel the booking.') };
  }
}

// Coach (own) or admin.
export async function markPrivateAttendance(
  sessionId: string,
  status: 'attended' | 'missed'
): Promise<MutationResult<PrivateAttendanceResult>> {
  try {
    const res = await api.patch<PrivateAttendanceResult>(`/private-class-sessions/${sessionId}/attendance`, {
      status,
    });
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to record attendance.') };
  }
}

// Coach (for themselves) or admin (with `coachId`).
export async function publishPrivateAvailability(
  data: PublishPrivateAvailabilityInput
): Promise<MutationResult<CoachPrivateAvailabilityRule[]>> {
  try {
    const res = await api.post<{ schedules: CoachPrivateAvailabilityRule[] }>('/private-class-schedules', data);
    return { status: 'success', data: res.data.schedules };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to publish availability.') };
  }
}

// Coach (own) or admin.
export async function removePrivateAvailabilityRule(
  id: string
): Promise<MutationResult<PrivateAvailabilityRemovalOutcome>> {
  try {
    const res = await api.delete<{ outcome: PrivateAvailabilityRemovalOutcome }>(`/private-class-schedules/${id}`);
    return { status: 'success', data: res.data.outcome };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to remove the slot.') };
  }
}
