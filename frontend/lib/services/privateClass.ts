import api from '../api';
import type {
  MyPrivateEnrollmentEntry,
  PrivateEnrollmentCreateResponse,
  PublicPrivateClassCoach,
} from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Public (no auth) ───────────────────────────────────────────────────────

export async function fetchPublicPrivateClassCoaches(): Promise<PublicPrivateClassCoach[]> {
  const res = await api.get<{ coaches: PublicPrivateClassCoach[] }>('/private-class-schedules/public');
  return res.data.coaches;
}

// ── Parent ──────────────────────────────────────────────────────────────────

export async function fetchMyPrivateEnrollments(): Promise<MyPrivateEnrollmentEntry[]> {
  const res = await api.get<{ enrollments: MyPrivateEnrollmentEntry[] }>(
    '/private-class-enrollments/mine'
  );
  return res.data.enrollments;
}

export async function createPrivateEnrollment(data: {
  studentId: string;
  scheduleId: string;
}): Promise<MutationResult<PrivateEnrollmentCreateResponse>> {
  try {
    const res = await api.post<PrivateEnrollmentCreateResponse>('/private-class-enrollments', data);
    return { status: 'success', data: res.data };
  } catch (err) {
    return {
      status: 'error',
      message: extractErrorMessage(err, 'Failed to register for private lessons. Please try again.'),
    };
  }
}

export async function cancelPrivateEnrollment(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.post(`/private-class-enrollments/${id}/cancel`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to cancel. Please try again.') };
  }
}
