'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import { fetchMyPrivateEnrollments, cancelPrivateEnrollment } from '../../../lib/services/privateClass';
import type { MyPrivateEnrollmentEntry } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

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

function chargeLabel(status: MyPrivateEnrollmentEntry['charges'][number]['status']): string {
  if (status === 'completed') return 'Paid';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

interface PrivateLessonsSectionProps {
  entries: MyPrivateEnrollmentEntry[];
  loading: boolean;
  onCancelled: () => void;
}

function PrivateLessonsSection({ entries, loading, onCancelled }: PrivateLessonsSectionProps) {
  const [cancelTarget, setCancelTarget] = useState<MyPrivateEnrollmentEntry | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function confirmCancel() {
    if (!cancelTarget) return;

    setCancelling(true);
    setCancelError(null);

    const result = await cancelPrivateEnrollment(cancelTarget.enrollment._id);

    setCancelling(false);

    if (result.status === 'success') {
      setCancelTarget(null);
      onCancelled();
    } else {
      setCancelError(result.message);
    }
  }

  return (
    <>
      <div className={styles.pageHeader} style={{ marginTop: 'var(--space-6)' }}>
        <h2 className={styles.pageTitle}>Private Lessons</h2>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : entries.length === 0 ? (
        <Card>
          <p>You don&apos;t have any private lessons yet.</p>
        </Card>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Coach</th>
                <th>Slot</th>
                <th>Per Session</th>
                <th>Status</th>
                <th>Recent Charges</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ enrollment, slot, charges }) => (
                <tr key={enrollment._id}>
                  <td>
                    {enrollment.studentId.firstName} {enrollment.studentId.lastName}
                  </td>
                  <td>
                    {enrollment.coachId.firstName} {enrollment.coachId.lastName}
                  </td>
                  <td>{slot ? `${DAY_LABELS[slot.dayOfWeek]} ${slot.startTime}` : '—'}</td>
                  <td>${enrollment.agreedHourlyRate.toFixed(2)}/hr</td>
                  <td>{enrollment.status}</td>
                  <td>
                    {charges.length === 0
                      ? '—'
                      : charges
                          .map((charge) => `${new Date(charge.createdAt).toLocaleDateString()} · $${charge.amount.toFixed(2)} (${chargeLabel(charge.status)})`)
                          .join(', ')}
                  </td>
                  <td>
                    {enrollment.status === 'active' ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCancelError(null);
                          setCancelTarget({ enrollment, slot, charges });
                        }}
                      >
                        Cancel Lessons
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {cancelTarget ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(27,26,23,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 400,
          }}
        >
          <div style={{ maxWidth: 420 }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>Cancel Private Lessons</h3>
              {cancelError ? <Alert variant="error">{cancelError}</Alert> : null}
              <p>
                All upcoming sessions will be removed and the weekly slot released. Completed sessions
                already charged are unaffected.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <Button type="button" variant="secondary" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                  Keep Lessons
                </Button>
                <Button type="button" variant="danger" onClick={confirmCancel} disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SubscriptionsPageContent() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [privateEntries, setPrivateEntries] = useState<MyPrivateEnrollmentEntry[]>([]);
  const [privateLoading, setPrivateLoading] = useState(true);

  const fetchPrivateEntries = useCallback(async () => {
    setPrivateLoading(true);
    try {
      const entries = await fetchMyPrivateEnrollments();
      setPrivateEntries(entries);
    } catch (err) {
      setPrivateEntries([]);
    } finally {
      setPrivateLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrivateEntries();
  }, [fetchPrivateEntries]);

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
      await api.post(`/subscriptions/${subscriptionId}/cancel`);

      // The bare cancel response returns the unpopulated Subscription
      // document (studentId/scheduleId as raw ObjectId strings, not the
      // populated objects the table renders) — merging it into local state
      // would blank out the student name / schedule display until the next
      // reload. Refetch the fully-populated list instead.
      await fetchSubscriptions();
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
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Registrations</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : subscriptions.length === 0 ? (
        <Card>
          <p>You don&apos;t have any registrations yet.</p>
        </Card>
      ) : (
        <Card>
          <table className={styles.table}>
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
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCancel(subscription._id)}
                        disabled={cancellingId === subscription._id}
                      >
                        {cancellingId === subscription._id ? 'Cancelling...' : 'Cancel'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <PrivateLessonsSection
        entries={privateEntries}
        loading={privateLoading}
        onCancelled={fetchPrivateEntries}
      />
    </main>
  );
}

export default function SubscriptionsPage() {
  return <SubscriptionsPageContent />;
}
