'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import api from '../../../../../lib/api';
import ProtectedRoute from '../../../../components/ProtectedRoute';

interface SessionItem {
  _id: string;
  date: string;
  students: { studentId: string; isPresent: boolean }[];
}

function CoachSessionsPageContent() {
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
      <h1>Sessions</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
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
                  <Link href={`/sessions/${session._id}/attendance`}>Mark Attendance</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function CoachSessionsPage() {
  return (
    <ProtectedRoute allowedRoles={['coach']}>
      <CoachSessionsPageContent />
    </ProtectedRoute>
  );
}
