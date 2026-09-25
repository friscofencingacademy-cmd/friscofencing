import api from '../api';
import type { CalendarQuery, CalendarResponse } from '../types';

// Calendar (docs/plans/calendar-view-plan.md). Queries only — they throw on
// failure; pair with useLoadState. The backend builds every event; these
// return the response verbatim.

function calendarParams({ from, to, coachId, type }: CalendarQuery): Record<string, string> {
  return {
    from,
    to,
    ...(coachId ? { coachId } : {}),
    ...(type !== 'all' ? { type } : {}),
  };
}

// ── Public (no auth) ───────────────────────────────────────────────────────

export async function fetchPublicCalendar(query: CalendarQuery): Promise<CalendarResponse> {
  const res = await api.get<CalendarResponse>('/calendar/public', { params: calendarParams(query) });
  return res.data;
}

// ── Parent ──────────────────────────────────────────────────────────────────

export async function fetchMyCalendar(query: CalendarQuery): Promise<CalendarResponse> {
  const res = await api.get<CalendarResponse>('/calendar/mine', { params: calendarParams(query) });
  return res.data;
}

// ── Admin ───────────────────────────────────────────────────────────────────

export async function fetchAdminCalendar(query: CalendarQuery): Promise<CalendarResponse> {
  const res = await api.get<CalendarResponse>('/calendar', { params: calendarParams(query) });
  return res.data;
}
