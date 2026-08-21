'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import Link from 'next/link';

import api from '../../../lib/api';
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
  levelId: string;
}

interface ScheduleOption {
  _id: string;
  classId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface LevelOption {
  _id: string;
  name: string;
}

interface PriceOption {
  _id: string;
  levelId: string;
  monthlyFee: number;
}

interface SavedPaymentMethod {
  _id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
}

interface RegistrationResponse {
  chargeAmount: number;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function levelName(levels: LevelOption[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

function RegisterPageContent() {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [groupClasses, setGroupClasses] = useState<GroupClassOption[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [levels, setLevels] = useState<LevelOption[]>([]);
  const [prices, setPrices] = useState<PriceOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SavedPaymentMethod | null>(null);

  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [scheduleId, setScheduleId] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchOptions() {
      setLoading(true);
      try {
        const [
          studentsRes,
          classesRes,
          schedulesRes,
          pricesRes,
          levelsRes,
          paymentMethodRes,
        ] = await Promise.all([
          api.get<{ students: StudentOption[] }>('/students/mine'),
          api.get<{ groupClasses: GroupClassOption[] }>('/group-classes'),
          api.get<{ schedules: ScheduleOption[] }>('/group-class-schedules'),
          api.get<{ prices: PriceOption[] }>('/prices'),
          api.get<{ levels: LevelOption[] }>('/levels'),
          api.get<{ paymentMethod: SavedPaymentMethod | null }>('/payment-methods/mine'),
        ]);

        if (isMounted) {
          setStudents(studentsRes.data.students);
          setGroupClasses(classesRes.data.groupClasses);
          setSchedules(schedulesRes.data.schedules);
          setPrices(pricesRes.data.prices);
          setLevels(levelsRes.data.levels);
          setPaymentMethod(paymentMethodRes.data.paymentMethod);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load registration options.');
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

  const filteredSchedules = classId
    ? schedules.filter((schedule) => schedule.classId === classId)
    : [];

  const selectedGroupClass = classId
    ? groupClasses.find((groupClass) => groupClass._id === classId) ?? null
    : null;

  const selectedPrice = selectedGroupClass
    ? prices.find((price) => price.levelId === selectedGroupClass.levelId) ?? null
    : null;

  const handleClassChange = useCallback((value: string) => {
    setClassId(value);
    setScheduleId('');
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const res = await api.post<RegistrationResponse>('/registrations', { studentId, scheduleId });
      setSuccessMessage(
        `Registration complete! Your card was charged $${res.data.chargeAmount.toFixed(2)}.`
      );
      setStudentId('');
      setClassId('');
      setScheduleId('');
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to register. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Register for a Class</h1>
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
      ) : !paymentMethod ? (
        <Card>
          <p>
            You&apos;ll need to add a payment method before registering — do that{' '}
            <Link href="/parent/payment-method">here</Link>.
          </p>
        </Card>
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
                onChange={(event) => setScheduleId(event.target.value)}
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

            {selectedGroupClass ? (
              selectedPrice ? (
                <div className={styles.formField}>
                  <p>
                    Level: {levelName(levels, selectedGroupClass.levelId)} — $
                    {selectedPrice.monthlyFee}/month
                  </p>
                </div>
              ) : (
                <div className={styles.formField}>
                  <Alert variant="error">Pricing is not configured for this class yet.</Alert>
                </div>
              )
            ) : null}

            <Button type="submit" disabled={submitting || !scheduleId}>
              {submitting ? 'Registering...' : 'Register'}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}

export default function RegisterPage() {
  return <RegisterPageContent />;
}
