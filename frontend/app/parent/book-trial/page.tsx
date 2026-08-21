'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses } from '../../../lib/services/catalog';
import { fetchSchedules, fetchSessionsBySchedule } from '../../../lib/services/scheduling';
import { bookTrialClass } from '../../../lib/services/parent';
import type { GroupClass, GroupClassSchedule, GroupClassSession } from '../../../lib/types';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import LoadError from '../../components/ui/LoadError/LoadError';
import {
  ChildPickerCards,
  FlowConfirmation,
  FlowMain,
  FlowSection,
  OrderSummary,
} from '../../components/portal/flow';

const STEPS = ['Who', 'Pick a Class', 'Confirmation'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function fetchBookingOptions() {
  const [groupClasses, schedules] = await Promise.all([fetchGroupClasses(), fetchSchedules()]);
  return { groupClasses, schedules };
}

interface BookedInfo {
  childName: string;
  sessionDate: string;
}

export default function BookTrialPage() {
  const { students, reload } = useParentPortal();
  const searchParams = useSearchParams();

  const { data, error, isLoading, retry } = useLoadState(fetchBookingOptions, []);
  const [groupClasses, setGroupClasses] = useState<GroupClass[]>([]);
  const [schedules, setSchedules] = useState<GroupClassSchedule[]>([]);

  useEffect(() => {
    if (data) {
      setGroupClasses(data.groupClasses);
      setSchedules(data.schedules);
    }
  }, [data]);

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<GroupClassSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<BookedInfo | null>(null);

  // Deep-link preselect: /parent/book-trial?child=<studentId>
  useEffect(() => {
    const preselect = searchParams.get('child');
    if (preselect) {
      setStudentId(preselect);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!scheduleId) {
      setSessions([]);
      return;
    }

    let cancelled = false;

    async function loadSessions() {
      setSessionsLoading(true);
      try {
        const result = await fetchSessionsBySchedule(scheduleId);
        if (cancelled) return;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        setSessions(result.filter((session) => new Date(session.date).getTime() >= todayStart.getTime()));
      } catch {
        if (!cancelled) {
          setStepError('Failed to load sessions.');
        }
      } finally {
        if (!cancelled) {
          setSessionsLoading(false);
        }
      }
    }

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, [scheduleId]);

  const filteredSchedules = classId ? schedules.filter((schedule) => schedule.classId === classId) : [];

  const handleClassChange = useCallback((value: string) => {
    setClassId(value);
    setScheduleId('');
    setSessionId('');
  }, []);

  const handleScheduleChange = useCallback((value: string) => {
    setScheduleId(value);
    setSessionId('');
  }, []);

  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedSession = sessions.find((session) => session._id === sessionId);

  async function handleSubmit() {
    setStepError(null);
    setSubmitting(true);

    const result = await bookTrialClass({ studentId, sessionId });

    setSubmitting(false);

    if (result.status === 'success') {
      setBooked({
        childName: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '',
        sessionDate: selectedSession ? new Date(selectedSession.date).toLocaleDateString() : '',
      });
      setStep(2);
      reload();
    } else {
      setStepError(result.message);
    }
  }

  if (error) {
    return (
      <main>
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      </main>
    );
  }

  if (step === 2) {
    return (
      <main>
        <FlowMain crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Book a Trial' }]} title="Book a Trial" steps={STEPS} current={2} singleColumn>
          <FlowConfirmation
            title="Trial class booked!"
            subtitle="We look forward to seeing you."
            lines={[
              { label: 'Child', value: booked?.childName },
              { label: 'Session', value: booked?.sessionDate },
            ]}
            links={
              <>
                <Button as="a" href="/parent/dashboard">
                  Back to Dashboard
                </Button>
                <Button as="a" href="/parent/register" variant="secondary">
                  Register for a Class
                </Button>
              </>
            }
          />
        </FlowMain>
      </main>
    );
  }

  const summary = (
    <OrderSummary
      lines={[
        { label: 'Child', value: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—' },
        {
          label: 'Schedule',
          value: scheduleId
            ? (() => {
                const schedule = schedules.find((s) => s._id === scheduleId);
                return schedule ? `${DAY_LABELS[schedule.dayOfWeek]} ${schedule.startTime}-${schedule.endTime}` : '—';
              })()
            : '—',
        },
        { label: 'Session', value: selectedSession ? new Date(selectedSession.date).toLocaleDateString() : '—' },
      ]}
      cta={step === 0 ? 'Continue' : 'Book Trial Class'}
      ctaDisabled={step === 0 ? !studentId : !sessionId}
      ctaLoading={submitting}
      onCta={step === 0 ? () => setStep(1) : handleSubmit}
    />
  );

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Book a Trial' }]}
        title="Book a Trial"
        steps={STEPS}
        current={step}
        summary={summary}
      >
        {stepError ? <Alert variant="error">{stepError}</Alert> : null}

        {isLoading ? (
          <p>Loading...</p>
        ) : step === 0 ? (
          <FlowSection title="Who is this trial for?">
            <ChildPickerCards students={students} selectedId={studentId} onSelect={setStudentId} />
          </FlowSection>
        ) : (
          <>
            <FlowSection title="Choose a class">
              <select
                aria-label="Class"
                value={classId}
                onChange={(e) => handleClassChange(e.target.value)}
                required
              >
                <option value="">Select a class</option>
                {groupClasses.map((groupClass) => (
                  <option key={groupClass._id} value={groupClass._id}>
                    {groupClass.name}
                  </option>
                ))}
              </select>
            </FlowSection>

            <FlowSection title="Choose a schedule">
              <select
                aria-label="Schedule"
                value={scheduleId}
                onChange={(e) => handleScheduleChange(e.target.value)}
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
            </FlowSection>

            <FlowSection title="Choose a session">
              <select
                aria-label="Session"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
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
            </FlowSection>

            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
          </>
        )}
      </FlowMain>
    </main>
  );
}
