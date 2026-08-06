'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

interface StudentRef {
  _id: string;
  firstName: string;
  lastName: string;
}

interface ScheduleRef {
  _id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

type SubscriptionStatus = 'active' | 'cancelled';

interface SubscriptionItem {
  _id: string;
  studentId: StudentRef;
  scheduleId: ScheduleRef;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
  nextBillingDate: string;
  lastChargeAmount: number | null;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatSchedule(schedule: ScheduleRef): string {
  return `${DAY_LABELS[schedule.dayOfWeek]} ${schedule.startTime}-${schedule.endTime}`;
}

// Renders the ISO date's calendar-day portion only — the backend is the
// source of truth for billing dates, this is display formatting only, never
// a value fed back into a request.
function formatDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function SubscriptionsPageContent() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.get<{ subscriptions: SubscriptionItem[] }>('/registrations/mine');
      setSubscriptions(res.data.subscriptions);
    } catch (err) {
      setError('Failed to load your registrations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  async function handleCancel(subscriptionId: string) {
    setError(null);
    setCancellingId(subscriptionId);

    try {
      const res = await api.post<{ subscription: SubscriptionItem }>(
        `/subscriptions/${subscriptionId}/cancel`
      );

      setSubscriptions((current) =>
        current.map((subscription) =>
          subscription._id === subscriptionId
            ? { ...subscription, ...res.data.subscription }
            : subscription
        )
      );
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to cancel. Please try again.';
      setError(message);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <main>
      <h1>My Registrations</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : subscriptions.length === 0 ? (
        <p>You don&apos;t have any registrations yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Schedule</th>
              <th>Status</th>
              <th>Current Period End</th>
              <th>Next Billing Date</th>
              <th>Last Charge</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((subscription) => (
              <tr key={subscription._id}>
                <td>
                  {subscription.studentId.firstName} {subscription.studentId.lastName}
                </td>
                <td>{formatSchedule(subscription.scheduleId)}</td>
                <td>{subscription.status}</td>
                <td>{formatDate(subscription.currentPeriodEnd)}</td>
                <td>{formatDate(subscription.nextBillingDate)}</td>
                <td>
                  {subscription.lastChargeAmount !== null
                    ? `$${subscription.lastChargeAmount.toFixed(2)}`
                    : '—'}
                </td>
                <td>
                  {subscription.status === 'cancelled' ? null : subscription.cancelAtPeriodEnd ? (
                    <span>Cancels at end of current period</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCancel(subscription._id)}
                      disabled={cancellingId === subscription._id}
                    >
                      {cancellingId === subscription._id ? 'Cancelling...' : 'Cancel'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function SubscriptionsPage() {
  return (
    <ProtectedRoute allowedRoles={['parent']}>
      <SubscriptionsPageContent />
    </ProtectedRoute>
  );
}
