import api from '../api';
import type { CoachPrivateAvailabilityRule, CoachPrivateBookingRow, PrivateBookingWindow } from '../types';

// A coach's own private-lesson queries. Mutations (publish/remove
// availability, cancel, mark attendance) are shared with admin and live in
// privateClass.ts.

export async function fetchMyPrivateAvailability(): Promise<CoachPrivateAvailabilityRule[]> {
  const res = await api.get<{ schedules: CoachPrivateAvailabilityRule[] }>('/private-class-schedules/mine');
  return res.data.schedules;
}

export async function fetchMyPrivateBookings(window: PrivateBookingWindow): Promise<CoachPrivateBookingRow[]> {
  const res = await api.get<{ sessions: CoachPrivateBookingRow[] }>('/private-class-sessions/mine', {
    params: { window },
  });
  return res.data.sessions;
}
