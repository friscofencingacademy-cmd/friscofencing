'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import api from '../../../../../lib/api';
import { formatDateOnly } from '../../../../../lib/formatDate';
import type { GroupClassSession } from '../../../../../lib/types';
import ProtectedRoute from '../../../../components/ProtectedRoute';
import AppShell from '../../../../components/layout/AppShell';
import Button from '../../../../components/ui/Button/Button';
import Card from '../../../../components/ui/Card/Card';
import Alert from '../../../../components/ui/Alert/Alert';
import styles from '../../../../components/ui/shared.module.css';

function CoachSessionsPageContent() {
  const params = useParams<{ id: string }>();
  const scheduleId = params.id;

  const [sessions, setSessions] = useState<GroupClassSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchSessions() {
      setLoading(true);
      try {
        const res = await api.get<{ sessions: GroupClassSession[] }>(
          `/group-class-sessions/by-schedule/${scheduleId}`
        );
        if (isMounted) {
          setSessions(res.data.sessions);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load sessions.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchSessions();

    return () => {
      isMounted = false;
    };
  }, [scheduleId]);

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Sessions</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Students</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) =>
                session.isHoliday ? (
                  <tr key={session._id}>
                    <td style={{ color: 'var(--color-muted)' }}>{formatDateOnly(session.date)}</td>
                    <td>
                      <span className={`${styles.chip} ${styles.chipMuted}`}>Holiday — {session.holidayName}</span>
                    </td>
                    <td />
                  </tr>
                ) : (
                  <tr key={session._id}>
                    <td>{formatDateOnly(session.date)}</td>
                    <td>{session.students.length}</td>
                    <td>
                      {session.attendanceOpen === false ? (
                        // Attendance opens on the session's own day
                        // (docs/plans/duplication-cleanup-plan.md A-D1) — the
                        // row keeps its student count but offers no link yet.
                        // Blocked only on an explicit `false`.
                        <span className={`${styles.chip} ${styles.chipMuted}`}>Not open yet</span>
                      ) : (
                        <Button
                          as="a"
                          href={`/sessions/${session._id}/attendance`}
                          size="sm"
                          variant="secondary"
                        >
                          Mark Attendance
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

export default function CoachSessionsPage() {
  return (
    <ProtectedRoute allowedRoles={['coach']}>
      <AppShell>
        <CoachSessionsPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
