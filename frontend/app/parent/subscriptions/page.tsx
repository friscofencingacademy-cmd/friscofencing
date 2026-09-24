'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';

import api from '../../../lib/api';
import { formatTime } from '../../../lib/formatTime';
import { DAY_LABELS } from '../../../lib/constants';
import { formatDateOnly } from '../../../lib/formatDate';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { cancelPrivateBooking, fetchMyPrivatePurchases } from '../../../lib/services/privateClass';
import { formatMoney } from '../../../lib/formatMoney';
import { bookingStatusLabel, formatLessonTime, personName } from '../../../lib/privateLessons';
import type { PrivateBookingRow, Subscription } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
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

// Private lessons (docs/decisions/011-private-per-session-booking.md): each
// purchase with its remaining sessions, what was paid, and its bookings.
// Everything shown — remaining, the amount, whether a booking can still be
// cancelled online — is a backend value.
function PrivateLessonsSection() {
  const { data, error, isLoading, retry } = useLoadState(fetchMyPrivatePurchases, []);
  const [cancelTarget, setCancelTarget] = useState<PrivateBookingRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function confirmCancel() {
    if (!cancelTarget) return;

    setCancelling(true);
    setCancelError(null);

    const result = await cancelPrivateBooking(cancelTarget._id);

    setCancelling(false);

    if (result.status === 'success') {
      setCancelTarget(null);
      retry();
    } else {
      setCancelError(result.message);
    }
  }

  return (
    <>
      <div className={styles.pageHeader} style={{ marginTop: 'var(--space-6)' }}>
        <h2 className={styles.pageTitle}>Private Lessons</h2>
        <p className={styles.pageSubtitle}>
          <Link href="/private-classes">Book a lesson</Link>
        </p>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading || !data ? (
        <p>Loading...</p>
      ) : data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>You don&apos;t have any private lessons yet.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {data.map(({ enrollment, remaining, payment, sessions }) => (
            <Card key={enrollment._id}>
              <h3 style={{ marginTop: 0 }}>
                {personName(enrollment.studentId, 'Student no longer available')} with{' '}
                {personName(enrollment.coachId, 'Coach no longer available')}
              </h3>
              <p className={styles.pageSubtitle}>
                {remaining} of {enrollment.quantity} sessions left · {enrollment.sessionDurationMinutes} min each
                {payment ? ` · Paid ${formatMoney(payment.amount)}` : ''}
              </p>

              {sessions.length === 0 ? null : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Lesson</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session._id}>
                        <td>{formatLessonTime(session.startDate)}</td>
                        <td>
                          <span className={`${styles.chip} ${styles.chipMuted}`}>{bookingStatusLabel(session)}</span>
                        </td>
                        <td>
                          {session.canCancel ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setCancelError(null);
                                setCancelTarget(session);
                              }}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel Lesson"
        size="sm"
        hideCloseButton
        disableClose={cancelling}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              Keep Lesson
            </Button>
            <Button type="button" variant="danger" onClick={confirmCancel} loading={cancelling}>
              Cancel Lesson
            </Button>
          </>
        }
      >
        {cancelError ? <Alert variant="error">{cancelError}</Alert> : null}
        <p style={{ margin: 0 }}>
          {cancelTarget
            ? `Cancel the lesson on ${formatLessonTime(cancelTarget.startDate)}? The session goes back to your balance so you can book another date.`
            : ''}
        </p>
      </Modal>
    </>
  );
}

function SubscriptionsPageContent() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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

      <PrivateLessonsSection />
    </main>
  );
}

export default function SubscriptionsPage() {
  return <SubscriptionsPageContent />;
}
