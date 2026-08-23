'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import api from '../../../lib/api';
import { DAY_LABELS } from '../../../lib/constants';
import { formatTime } from '../../../lib/formatTime';
import ProtectedRoute from '../../components/ProtectedRoute';
import AppShell from '../../components/layout/AppShell';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

interface GroupClassOption {
  _id: string;
  name: string;
}

interface ScheduleItem {
  _id: string;
  classId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  students: string[];
}

function classNameFor(groupClasses: GroupClassOption[], id: string): string {
  return groupClasses.find((groupClass) => groupClass._id === id)?.name ?? id;
}

function CoachSchedulesPageContent() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [groupClasses, setGroupClasses] = useState<GroupClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [schedulesRes, classesRes] = await Promise.all([
        api.get<{ schedules: ScheduleItem[] }>('/group-class-schedules/mine'),
        api.get<{ groupClasses: GroupClassOption[] }>('/group-classes'),
      ]);
      setSchedules(schedulesRes.data.schedules);
      setGroupClasses(classesRes.data.groupClasses);
    } catch (err) {
      setError('Failed to load schedules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Schedules</h1>
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
                <th>Class</th>
                <th>Day</th>
                <th>Start</th>
                <th>End</th>
                <th>Roster</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule._id}>
                  <td>{classNameFor(groupClasses, schedule.classId)}</td>
                  <td>{DAY_LABELS[schedule.dayOfWeek]}</td>
                  <td>{formatTime(schedule.startTime)}</td>
                  <td>{formatTime(schedule.endTime)}</td>
                  <td>{schedule.students.length}</td>
                  <td>
                    <Link href={`/coach/schedules/${schedule._id}/sessions`}>View Sessions</Link>
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

export default function CoachSchedulesPage() {
  return (
    <ProtectedRoute allowedRoles={['coach']}>
      <AppShell>
        <CoachSchedulesPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
