import api from '../api';
import { GRID_DAYS, dayString } from '../calendarView';
import { addCalendarDays, todayInAcademyTZ } from '../formatDate';
import type { CalendarQuery, CalendarResponse, PrivateOpenSlot } from '../types';

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

/**
 * Every open private-lesson slot of one coach, from today to the booking
 * horizon — the booking wizard's date-then-time picker. The calendar's open
 * slots come from the same backend code the booking itself checks
 * (openSlotsForRules), so the picker can't offer what booking would refuse.
 * A request spans at most GRID_DAYS, so this pages until the server's own
 * `horizonTo`.
 */
export async function fetchCoachOpenPrivateSlots(coachId: string): Promise<PrivateOpenSlot[]> {
  const slots: PrivateOpenSlot[] = [];
  let from = todayInAcademyTZ();

  for (;;) {
    const to = addCalendarDays(from, GRID_DAYS - 1);
    const res = await fetchPublicCalendar({ from: dayString(from), to: dayString(to), coachId, type: 'private' });

    res.events.forEach((event) => {
      if (event.kind === 'private-open' && event.scheduleId && event.startsAt && event.endsAt) {
        slots.push({ scheduleId: event.scheduleId, day: event.day, startsAt: event.startsAt, endsAt: event.endsAt });
      }
    });

    if (!res.horizonTo || res.horizonTo <= dayString(to)) return slots;
    from = addCalendarDays(to, 1);
  }
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
