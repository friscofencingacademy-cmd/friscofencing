import api from '../api';
import type { PrivateClassEnrollmentRow, PrivateClassScheduleRow } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Schedules (admin view — all coaches) ────────────────────────────────────

export async function fetchPrivateClassSchedulesAdmin(params: {
  coachId?: string;
  available?: boolean;
} = {}): Promise<PrivateClassScheduleRow[]> {
  const res = await api.get<{ schedules: PrivateClassScheduleRow[] }>('/private-class-schedules', {
    params,
  });
  return res.data.schedules;
}

export async function createPrivateClassScheduleAdmin(data: {
  coachId: string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes?: number;
}): Promise<MutationResult<PrivateClassScheduleRow>> {
  try {
    const res = await api.post<{ schedule: PrivateClassScheduleRow }>('/private-class-schedules', data);
    return { status: 'success', data: res.data.schedule };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create slot.') };
  }
}

export async function deletePrivateClassSchedule(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/private-class-schedules/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete slot.') };
  }
}

// ── Enrollments (admin view — all parents) ──────────────────────────────────

export async function fetchPrivateClassEnrollmentsAdmin(params: {
  status?: string;
  coachId?: string;
} = {}): Promise<PrivateClassEnrollmentRow[]> {
  const res = await api.get<{ enrollments: PrivateClassEnrollmentRow[] }>(
    '/private-class-enrollments',
    { params }
  );
  return res.data.enrollments;
}

export async function cancelPrivateClassEnrollmentAdmin(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.post(`/private-class-enrollments/${id}/cancel`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to cancel enrollment.') };
  }
}
