'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface GroupClassOption {
  _id: string;
  name: string;
}

interface CoachOption {
  _id: string;
  firstName: string;
  lastName: string;
}

interface ScheduleItem {
  _id: string;
  classId: string;
  coachId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  students: string[];
}

function classNameFor(groupClasses: GroupClassOption[], id: string): string {
  return groupClasses.find((groupClass) => groupClass._id === id)?.name ?? id;
}

function coachNameFor(coaches: CoachOption[], id: string): string {
  const coach = coaches.find((c) => c._id === id);
  return coach ? `${coach.firstName} ${coach.lastName}` : id;
}

function SchedulesPageContent() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [groupClasses, setGroupClasses] = useState<GroupClassOption[]>([]);
  const [coaches, setCoaches] = useState<CoachOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [classId, setClassId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [schedulesRes, classesRes, coachesRes] = await Promise.all([
        api.get<{ schedules: ScheduleItem[] }>('/group-class-schedules'),
        api.get<{ groupClasses: GroupClassOption[] }>('/group-classes'),
        api.get<{ users: CoachOption[] }>('/users', { params: { role: 'coach' } }),
      ]);
      setSchedules(schedulesRes.data.schedules);
      setGroupClasses(classesRes.data.groupClasses);
      setCoaches(coachesRes.data.users);
    } catch (err) {
      setError('Failed to load schedules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post('/group-class-schedules', {
        classId,
        coachId,
        dayOfWeek: Number(dayOfWeek),
        startTime,
        endTime,
      });
      setClassId('');
      setCoachId('');
      setDayOfWeek('1');
      setStartTime('');
      setEndTime('');
      await fetchAll();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to create schedule.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Group Class Schedules</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Coach</th>
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
                <td>{coachNameFor(coaches, schedule.coachId)}</td>
                <td>{DAY_LABELS[schedule.dayOfWeek]}</td>
                <td>{schedule.startTime}</td>
                <td>{schedule.endTime}</td>
                <td>{schedule.students.length}</td>
                <td>
                  <Link href={`/admin/schedules/${schedule._id}/sessions`}>View Sessions</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Add Schedule</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="classId">Class</label>
          <select
            id="classId"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
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
        <div>
          <label htmlFor="coachId">Coach</label>
          <select
            id="coachId"
            value={coachId}
            onChange={(event) => setCoachId(event.target.value)}
            required
          >
            <option value="">Select a coach</option>
            {coaches.map((coach) => (
              <option key={coach._id} value={coach._id}>
                {coach.firstName} {coach.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dayOfWeek">Day of Week</label>
          <select
            id="dayOfWeek"
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(event.target.value)}
          >
            {DAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="startTime">Start Time</label>
          <input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="endTime">End Time</label>
          <input
            id="endTime"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Schedule'}
        </button>
      </form>
    </main>
  );
}

export default function SchedulesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <SchedulesPageContent />
    </ProtectedRoute>
  );
}
