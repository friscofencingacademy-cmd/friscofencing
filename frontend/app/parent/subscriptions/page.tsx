'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import { formatTime } from '../../../lib/formatTime';
import { DAY_LABELS } from '../../../lib/constants';
import { formatDateOnly, formatInstant } from '../../../lib/formatDate';
import { fetchMyPrivateEnrollments, cancelPrivateEnrollment } from '../../../lib/services/privateClass';
import type { MyPrivateEnrollmentEntry, Subscription } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

function formatSchedule(schedule: Subscription['scheduleId']): string {
  return `${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)}`;
}

// currentPeriodEnd/nextBillingDate are calendar-day sentinels — the backend
// is the source of truth for billing dates, this is display formatting
// only, never a value fed back into a request. formatDateOnly renders it
// UTC-anchored, never browser-local (docs/plans/utc-date-standard-plan.md).
function formatDate(isoDate: string): string {
  return formatDateOnly(isoDate);
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
                    {enrollment.studentId
                      ? `${enrollment.studentId.firstName} ${enrollment.studentId.lastName}`
                      : 'Student no longer available'}
                  </td>
                  <td>
                    {enrollment.coachId
                      ? `${enrollment.coachId.firstName} ${enrollment.coachId.lastName}`
                      : 'Coach no longer available'}
                  </td>
                  <td>{slot ? `${DAY_LABELS[slot.dayOfWeek]} ${formatTime(slot.startTime)}` : '—'}</td>
                  <td>${enrollment.agreedHourlyRate.toFixed(2)}/hr</td>
                  <td>{enrollment.status}</td>
                  <td>
                    {charges.length === 0
                      ? '—'
                      : charges
                          .map((charge) => `${formatInstant(charge.createdAt)} · $${charge.amount.toFixed(2)} (${chargeLabel(charge.status)})`)
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
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
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
      const res = await api.get<{ subscriptions: Subscription[] }>('/registrations/mine');
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
                <th>Last Payment</th>
                <th>Sibling Discount (Current)</th>
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
                    {/* Sourced from the Registration ledger (docs/plans/
                        payment-airtight-plan.md D11) — the real total
                        actually charged, fee included. Never
                        Subscription.lastChargeAmount, which is deliberately
                        fee-free and would understate a real payment that
                        bundled a one-time registration fee. */}
                    {subscription.lastPayment ? `$${subscription.lastPayment.amount.toFixed(2)}` : '—'}
                    {subscription.lastPayment?.chargeMethod === 'manual' ? (
                      <span className={`${styles.chip} ${styles.chipMuted}`} style={{ marginLeft: 6 }}>
                        Manual
                      </span>
                    ) : null}
                    {subscription.lastSiblingDiscountApplied ? (
                      <span className={`${styles.chip} ${styles.chipMuted}`} style={{ marginLeft: 6 }}>
                        10% sibling
                      </span>
                    ) : null}
                    {subscription.firstChargeProrated ? (
                      <span className={`${styles.chip} ${styles.chipMuted}`} style={{ marginLeft: 6 }}>
                        Prorated first month
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {/* Live, computed fresh on every load — never the stale
                        lastChargeAmount/lastSiblingDiscountApplied snapshot
                        above, which only reflects what happened at THIS
                        subscription's own last charge and can go stale the
                        moment a sibling's situation changes. */}
                    {!subscription.currentCharge ? (
                      <span style={{ color: 'var(--color-muted)' }}>—</span>
                    ) : (
                      <>
                        {subscription.currentCharge.siblingDiscountApplied ? (
                          <span className={`${styles.chip} ${styles.chipMuted}`}>
                            10% sibling — ${subscription.currentCharge.amount.toFixed(2)}/mo
                          </span>
                        ) : (
                          <span>Full price</span>
                        )}
                        {subscription.currentCharge.reason ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: 2 }}>
                            {subscription.currentCharge.reason}
                          </div>
                        ) : null}
                      </>
                    )}
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
