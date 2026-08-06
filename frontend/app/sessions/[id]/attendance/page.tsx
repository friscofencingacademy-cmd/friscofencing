'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';

import api from '../../../../lib/api';
import ProtectedRoute from '../../../components/ProtectedRoute';

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
      <h1>Mark Attendance</h1>

      {error ? <p role="alert">{error}</p> : null}
      {message ? <p>{message}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : session ? (
        <>
          <ul>
            {session.students.map((entry) => (
              <li key={entry.studentId._id}>
                <label>
                  <input
                    type="checkbox"
                    checked={attendance[entry.studentId._id] ?? false}
                    onChange={() => toggleStudent(entry.studentId._id)}
                  />
                  {entry.studentId.firstName} {entry.studentId.lastName}
                </label>
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Attendance'}
          </button>
        </>
      ) : null}
    </main>
  );
}

export default function AttendancePage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin', 'coach']}>
      <AttendancePageContent />
    </ProtectedRoute>
  );
}
