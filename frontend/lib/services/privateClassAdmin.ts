import api from '../api';
import type {
  AdminPrivateAvailabilityRule,
  AdminPrivateBookingRow,
  PrivateBookingStatus,
  PrivateEnrollmentStatus,
  PrivatePurchaseEntry,
} from '../types';

// Admin (all coaches, all families) private-lesson queries. Mutations are
// shared with coaches/parents and live in privateClass.ts.

export async function fetchPrivateAvailabilityAdmin(params: { coachId?: string } = {}): Promise<AdminPrivateAvailabilityRule[]> {
  const res = await api.get<{ schedules: AdminPrivateAvailabilityRule[] }>('/private-class-schedules', { params });
  return res.data.schedules;
}

export async function fetchPrivatePurchasesAdmin(
  params: { status?: PrivateEnrollmentStatus; coachId?: string } = {}
): Promise<PrivatePurchaseEntry[]> {
  const res = await api.get<{ enrollments: PrivatePurchaseEntry[] }>('/private-class-enrollments', { params });
  return res.data.enrollments;
}

export async function fetchPrivateBookingsAdmin(
  params: { status?: PrivateBookingStatus; coachId?: string } = {}
): Promise<AdminPrivateBookingRow[]> {
  const res = await api.get<{ sessions: AdminPrivateBookingRow[] }>('/private-class-sessions', { params });
  return res.data.sessions;
}
