'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import api from '../../../../../lib/api';
import Button from '../../../../components/ui/Button/Button';
import Card from '../../../../components/ui/Card/Card';
import Alert from '../../../../components/ui/Alert/Alert';
import styles from '../../../../components/ui/shared.module.css';

interface SessionItem {
  _id: string;
  date: string;
  students: { studentId: string; isPresent: boolean }[];
}

function SessionsPageContent() {
  const params = useParams<{ id: string }>();
  const scheduleId = params.id;

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchSessions() {
      setLoading(true);
      try {
        const res = await api.get<{ sessions: SessionItem[] }>(
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
              {sessions.map((session) => (
                <tr key={session._id}>
                  <td>{new Date(session.date).toLocaleDateString()}</td>
                  <td>{session.students.length}</td>
                  <td>
                    <Button
                      as="a"
                      href={`/sessions/${session._id}/attendance`}
                      size="sm"
                      variant="secondary"
                    >
                      Mark Attendance
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

export default function SessionsPage() {
  return <SessionsPageContent />;
}
