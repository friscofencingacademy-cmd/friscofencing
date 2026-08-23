import api from '../api';
import type {
  Coach,
  GroupClassSchedule,
  GroupClassSession,
  GroupClassSessionDetail,
  GroupClassSessionWithSchedule,
  PublicGroupClassSchedule,
  SessionStudentEntry,
} from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Public (no auth) ─────────────────────────────────────────────────────

export async function fetchPublicSchedules(): Promise<PublicGroupClassSchedule[]> {
  const res = await api.get<{ schedules: PublicGroupClassSchedule[] }>(
    '/group-class-schedules/public'
  );
  return res.data.schedules;
}

// ── Coaches (used by the schedule create/edit form) ─────────────────────

export async function fetchCoaches(): Promise<Coach[]> {
  const res = await api.get<{ users: Coach[] }>('/users', { params: { role: 'coach' } });
  return res.data.users;
}

// ── Schedules ────────────────────────────────────────────────────────────

export async function fetchSchedules(): Promise<GroupClassSchedule[]> {
  const res = await api.get<{ schedules: GroupClassSchedule[] }>('/group-class-schedules');
  return res.data.schedules;
}

export async function fetchMySchedules(): Promise<GroupClassSchedule[]> {
  const res = await api.get<{ schedules: GroupClassSchedule[] }>('/group-class-schedules/mine');
  return res.data.schedules;
}

export async function createSchedule(
  data: Pick<GroupClassSchedule, 'classId' | 'coachId' | 'dayOfWeek' | 'startTime' | 'endTime'>
): Promise<MutationResult<GroupClassSchedule>> {
  try {
    const res = await api.post<{ schedule: GroupClassSchedule }>('/group-class-schedules', data);
    return { status: 'success', data: res.data.schedule };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create schedule.') };
  }
}

// Schedule edit/delete is deliberately deferred (ripple effects on generated
// sessions/rosters) — see docs/decisions/002-ckq-ui-adoption.md. Schedules
// stay create + list only.

// ── Sessions ─────────────────────────────────────────────────────────────

export async function fetchSessionsBySchedule(scheduleId: string): Promise<GroupClassSession[]> {
  const res = await api.get<{ sessions: GroupClassSession[] }>(
    `/group-class-sessions/by-schedule/${scheduleId}`
  );
  return res.data.sessions;
}

// Trial booking's session picker — every upcoming session across ALL of a
// class's schedules (next 30 days, server-filtered), so the parent picks a
// session directly instead of a schedule first.
export async function fetchSessionsByClass(classId: string): Promise<GroupClassSessionWithSchedule[]> {
  const res = await api.get<{ sessions: GroupClassSessionWithSchedule[] }>(
    `/group-class-sessions/by-class/${classId}`
  );
  return res.data.sessions;
}

export async function fetchSessionById(id: string): Promise<GroupClassSessionDetail> {
  const res = await api.get<{ session: GroupClassSessionDetail }>(`/group-class-sessions/${id}`);
  return res.data.session;
}

export async function markAttendance(
  sessionId: string,
  students: SessionStudentEntry[]
): Promise<MutationResult<undefined>> {
  try {
    await api.patch(`/group-class-sessions/${sessionId}/attendance`, { students });
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to save attendance.') };
  }
}
