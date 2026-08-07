'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';

import api from '../../../../lib/api';
import ProtectedRoute from '../../../components/ProtectedRoute';
import AppShell from '../../../components/layout/AppShell';
import Button from '../../../components/ui/Button/Button';
import Card from '../../../components/ui/Card/Card';
import Alert from '../../../components/ui/Alert/Alert';
import styles from '../../../components/ui/shared.module.css';

interface PopulatedStudent {
  _id: string;
  firstName: string;
  lastName: string;
}

interface SessionStudentEntry {
  studentId: PopulatedStudent;
  isPresent: boolean;
}

interface SessionDetail {
  _id: string;
  date: string;
  students: SessionStudentEntry[];
}

function AttendancePageContent() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchSession() {
      setLoading(true);
      try {
        const res = await api.get<{ session: SessionDetail }>(
          `/group-class-sessions/${sessionId}`
        );
        if (isMounted) {
          setSession(res.data.session);

          const initialAttendance: Record<string, boolean> = {};
          res.data.session.students.forEach((entry) => {
            initialAttendance[entry.studentId._id] = entry.isPresent;
          });
          setAttendance(initialAttendance);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load session.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchSession();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  function toggleStudent(studentId: string) {
    setAttendance((previous) => ({ ...previous, [studentId]: !previous[studentId] }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await api.patch(`/group-class-sessions/${sessionId}/attendance`, {
        students: Object.entries(attendance).map(([studentId, isPresent]) => ({
          studentId,
          isPresent,
        })),
      });
      setMessage('Attendance saved.');
    } catch (err) {
      const responseMessage =
        axios.isAxiosError(err) && err.response?.data?.message
          ? err.response.data.message
          : 'Failed to save attendance.';
      setError(responseMessage);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Mark Attendance</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="success">{message}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : session ? (
        <Card>
          <table className={styles.table}>
            <tbody>
              {session.students.map((entry) => (
                <tr key={entry.studentId._id}>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={attendance[entry.studentId._id] ?? false}
                        onChange={() => toggleStudent(entry.studentId._id)}
                      />{' '}
                      {entry.studentId.firstName} {entry.studentId.lastName}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
          </div>
        </Card>
      ) : null}
    </main>
  );
}

export default function AttendancePage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin', 'coach']}>
      <AppShell>
        <AttendancePageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
