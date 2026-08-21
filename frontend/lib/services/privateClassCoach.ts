import api from '../api';
import type {
  PrivateAttendanceResult,
  PrivateClassScheduleRow,
  PrivateClassSessionRow,
} from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── A coach's own published slots ──────────────────────────────────────────

export async function fetchMyPrivateClassSchedules(): Promise<PrivateClassScheduleRow[]> {
  const res = await api.get<{ schedules: PrivateClassScheduleRow[] }>(
    '/private-class-schedules/mine'
  );
  return res.data.schedules;
}

export async function createMyPrivateClassSchedule(data: {
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

export async function deleteMyPrivateClassSchedule(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/private-class-schedules/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete slot.') };
  }
}

// ── A coach's own sessions ──────────────────────────────────────────────────

export type PrivateClassSessionWindow = 'upcoming' | 'unmarked' | 'past';

export async function fetchMyPrivateClassSessions(
  window: PrivateClassSessionWindow
): Promise<PrivateClassSessionRow[]> {
  const res = await api.get<{ sessions: PrivateClassSessionRow[] }>('/private-class-sessions/mine', {
    params: { window },
  });
  return res.data.sessions;
}

export async function markPrivateClassAttendance(
  sessionId: string,
  status: 'attended' | 'missed'
): Promise<MutationResult<PrivateAttendanceResult>> {
  try {
    const res = await api.patch<PrivateAttendanceResult>(
      `/private-class-sessions/${sessionId}/attendance`,
      { status }
    );
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to record attendance.') };
  }
}

export async function retryPrivateClassCharge(
  sessionId: string
): Promise<MutationResult<PrivateAttendanceResult>> {
  try {
    const res = await api.post<PrivateAttendanceResult>(
      `/private-class-sessions/${sessionId}/retry-charge`
    );
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to retry the charge.') };
  }
}
