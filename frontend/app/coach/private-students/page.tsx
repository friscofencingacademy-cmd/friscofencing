'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  fetchMyPrivateClassSessions,
  markPrivateClassAttendance,
  retryPrivateClassCharge,
} from '../../../lib/services/privateClassCoach';
import { formatInstant } from '../../../lib/formatDate';
import type { PrivateAttendanceResult, PrivateClassSessionRow } from '../../../lib/types';
import ProtectedRoute from '../../components/ProtectedRoute';
import AppShell from '../../components/layout/AppShell';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import styles from '../../components/ui/shared.module.css';

// session.startDate is a real instant (docs/plans/utc-date-standard-plan.md)
// — rendered via formatInstant (Central-anchored), never browser-local.
function formatDateTime(iso: string): string {
  return formatInstant(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function studentName(session: PrivateClassSessionRow): string {
  return `${session.studentId.firstName} ${session.studentId.lastName}`;
}

function parentName(session: PrivateClassSessionRow): string {
  return `${session.parentId.firstName} ${session.parentId.lastName}`;
}

interface ConfirmState {
  session: PrivateClassSessionRow;
  status: 'attended' | 'missed';
}

interface SessionOutcome {
  attendance: 'attended' | 'missed';
  chargeStatus?: PrivateAttendanceResult['chargeStatus'];
  reason?: string;
}

function CoachPrivateStudentsPageContent() {
  const [unmarked, setUnmarked] = useState<PrivateClassSessionRow[]>([]);
  const [upcoming, setUpcoming] = useState<PrivateClassSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SessionOutcome>>({});
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [unmarkedSessions, upcomingSessions] = await Promise.all([
        fetchMyPrivateClassSessions('unmarked'),
        fetchMyPrivateClassSessions('upcoming'),
      ]);
      setUnmarked(unmarkedSessions);
      setUpcoming(upcomingSessions);
    } catch (err) {
      setError('Failed to load your private-lesson sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmMark() {
    if (!confirm) return;

    setSubmitting(true);
    setConfirmError(null);

    const result = await markPrivateClassAttendance(confirm.session._id, confirm.status);

    setSubmitting(false);

    if (result.status === 'success') {
      // The row stays visible in "Needs Attention" — filtering it out here
      // would hide the Charged/Charge-failed result the coach just asked
      // for. It naturally drops off on the next full reload once its
      // attendance is no longer 'scheduled'.
      setOutcomes((prev) => ({
        ...prev,
        [confirm.session._id]: {
          attendance: confirm.status,
          chargeStatus: result.data.chargeStatus,
          reason: result.data.reason,
        },
      }));
      setConfirm(null);
    } else {
      setConfirmError(result.message);
    }
  }

  async function retry(sessionId: string) {
    setRetryingId(sessionId);

    const result = await retryPrivateClassCharge(sessionId);

    setRetryingId(null);

    if (result.status === 'success') {
      setOutcomes((prev) => ({
        ...prev,
        [sessionId]: { attendance: 'attended', chargeStatus: result.data.chargeStatus },
      }));
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Private Students</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <h2 style={{ fontSize: '1.1rem' }}>Needs Attention</h2>
          {unmarked.length === 0 ? (
            <Card>
              <p style={{ margin: 0 }}>No sessions need attendance right now.</p>
            </Card>
          ) : (
            <Card>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>When</th>
                    <th>Amount</th>
                    <th>Result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {unmarked.map((session) => {
                    const outcome = outcomes[session._id];
                    return (
                      <tr key={session._id}>
                        <td>{studentName(session)}</td>
                        <td>{formatDateTime(session.startDate)}</td>
                        <td>{session.sessionPrice != null ? `$${session.sessionPrice.toFixed(2)}` : '—'}</td>
                        <td>
                          {outcome?.attendance === 'missed' ? (
                            <span className={styles.pageSubtitle}>Missed</span>
                          ) : outcome?.chargeStatus === 'completed' ? (
                            <span style={{ color: 'var(--color-success)' }}>Charged</span>
                          ) : outcome?.chargeStatus === 'failed' ? (
                            <span style={{ color: 'var(--color-error)' }}>Charge failed</span>
                          ) : outcome?.reason === 'enrollment_cancelled' ? (
                            <span className={styles.pageSubtitle}>Marked — not charged (cancelled)</span>
                          ) : (
                            '—'
                          )}
                          {outcome?.chargeStatus === 'failed' ? (
                            <div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => retry(session._id)}
                                disabled={retryingId === session._id}
                              >
                                {retryingId === session._id ? 'Retrying…' : 'Retry charge'}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {outcome ? null : (
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  setConfirmError(null);
                                  setConfirm({ session, status: 'attended' });
                                }}
                              >
                                Attended
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setConfirmError(null);
                                  setConfirm({ session, status: 'missed' });
                                }}
                              >
                                Missed
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          <h2 style={{ fontSize: '1.1rem', marginTop: 'var(--space-6)' }}>Upcoming</h2>
          {upcoming.length === 0 ? (
            <Card>
              <p style={{ margin: 0 }}>No upcoming private-lesson sessions.</p>
            </Card>
          ) : (
            <Card>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((session) => (
                    <tr key={session._id}>
                      <td>{studentName(session)}</td>
                      <td>{formatDateTime(session.startDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {confirm ? (
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
              <h3 style={{ marginTop: 0 }}>{confirm.status === 'attended' ? 'Mark Attended' : 'Mark Missed'}</h3>
              {confirmError ? <Alert variant="error">{confirmError}</Alert> : null}
              <p>
                {confirm.status === 'attended'
                  ? `Mark attended and charge ${parentName(confirm.session)}'s card ${
                      confirm.session.sessionPrice != null ? `$${confirm.session.sessionPrice.toFixed(2)}` : ''
                    }?`
                  : `Mark ${studentName(confirm.session)}'s session as missed?`}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <Button type="button" variant="secondary" onClick={() => setConfirm(null)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="button" onClick={confirmMark} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Confirm'}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function CoachPrivateStudentsPage() {
  return (
    <ProtectedRoute allowedRoles={['coach']}>
      <AppShell>
        <CoachPrivateStudentsPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
