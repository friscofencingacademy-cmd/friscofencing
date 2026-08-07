'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

interface StudentOption {
  _id: string;
  firstName: string;
  lastName: string;
}

interface GroupClassOption {
  _id: string;
  name: string;
}

interface ScheduleOption {
  _id: string;
  classId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface SessionOption {
  _id: string;
  date: string;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function BookTrialPageContent() {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [groupClasses, setGroupClasses] = useState<GroupClassOption[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);

  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [sessionId, setSessionId] = useState('');

  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchOptions() {
      setLoading(true);
      try {
        const [studentsRes, classesRes, schedulesRes] = await Promise.all([
          api.get<{ students: StudentOption[] }>('/students/mine'),
          api.get<{ groupClasses: GroupClassOption[] }>('/group-classes'),
          api.get<{ schedules: ScheduleOption[] }>('/group-class-schedules'),
        ]);

        if (isMounted) {
          setStudents(studentsRes.data.students);
          setGroupClasses(classesRes.data.groupClasses);
          setSchedules(schedulesRes.data.schedules);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load booking options.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!scheduleId) {
      setSessions([]);
      return;
    }

    let isMounted = true;

    async function fetchSessions() {
      setSessionsLoading(true);
      try {
        const res = await api.get<{ sessions: SessionOption[] }>(
          `/group-class-sessions/by-schedule/${scheduleId}`
        );

        if (isMounted) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          setSessions(
            res.data.sessions.filter(
              (session) => new Date(session.date).getTime() >= todayStart.getTime()
            )
          );
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load sessions.');
        }
      } finally {
        if (isMounted) {
          setSessionsLoading(false);
        }
      }
    }

    fetchSessions();

    return () => {
      isMounted = false;
    };
  }, [scheduleId]);

  const filteredSchedules = classId
    ? schedules.filter((schedule) => schedule.classId === classId)
    : [];

  const handleClassChange = useCallback((value: string) => {
    setClassId(value);
    setScheduleId('');
    setSessionId('');
  }, []);

  const handleScheduleChange = useCallback((value: string) => {
    setScheduleId(value);
    setSessionId('');
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      await api.post('/trial-classes', { studentId, sessionId });
      setSuccessMessage('Trial class booked! We look forward to seeing you.');
      setStudentId('');
      setClassId('');
      setScheduleId('');
      setSessionId('');
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to book trial class. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Book a Trial Class</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      {successMessage ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="success">{successMessage}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <Card>
          <form onSubmit={handleSubmit}>
            <div className={styles.formField}>
              <label htmlFor="studentId" className={styles.formLabel}>
                Child
              </label>
              <select
                id="studentId"
                className={styles.formSelect}
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                required
              >
                <option value="">Select a child</option>
                {students.map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.firstName} {student.lastName}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label htmlFor="classId" className={styles.formLabel}>
                Class
              </label>
              <select
                id="classId"
                className={styles.formSelect}
                value={classId}
                onChange={(event) => handleClassChange(event.target.value)}
                required
              >
                <option value="">Select a class</option>
                {groupClasses.map((groupClass) => (
                  <option key={groupClass._id} value={groupClass._id}>
                    {groupClass.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label htmlFor="scheduleId" className={styles.formLabel}>
                Schedule
              </label>
              <select
                id="scheduleId"
                className={styles.formSelect}
                value={scheduleId}
                onChange={(event) => handleScheduleChange(event.target.value)}
                required
                disabled={!classId}
              >
                <option value="">Select a schedule</option>
                {filteredSchedules.map((schedule) => (
                  <option key={schedule._id} value={schedule._id}>
                    {DAY_LABELS[schedule.dayOfWeek]} {schedule.startTime}-{schedule.endTime}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formField}>
              <label htmlFor="sessionId" className={styles.formLabel}>
                Session
              </label>
              <select
                id="sessionId"
                className={styles.formSelect}
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                required
                disabled={!scheduleId || sessionsLoading}
              >
                <option value="">Select a session</option>
                {sessions.map((session) => (
                  <option key={session._id} value={session._id}>
                    {new Date(session.date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Booking...' : 'Book Trial Class'}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}

export default function BookTrialPage() {
  return (
    <ProtectedRoute allowedRoles={['parent']}>
      <AppShell>
        <BookTrialPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
