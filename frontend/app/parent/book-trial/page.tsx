'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses } from '../../../lib/services/catalog';
import { fetchSessionsByClass } from '../../../lib/services/scheduling';
import { bookTrialClass } from '../../../lib/services/parent';
import { formatTime } from '../../../lib/formatTime';
import type { GroupClass, GroupClassSessionWithSchedule } from '../../../lib/types';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import LoadError from '../../components/ui/LoadError/LoadError';
import {
  ChildPickerCards,
  FlowConfirmation,
  FlowMain,
  FlowSection,
  OrderSummary,
  PillRow,
} from '../../components/portal/flow';

const STEPS = ['Who', 'Pick a Class', 'Confirmation'];

async function fetchBookingOptions() {
  const groupClasses = await fetchGroupClasses();
  return { groupClasses };
}

// A session carries its own schedule's day/time now (no separate schedule
// selection) — both the pill picker and the summary/confirmation derive
// their display strings from the session itself, never a cross-referenced
// schedule list.
function formatSessionDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatSessionTimeRange(schedule: GroupClassSessionWithSchedule['scheduleId']): string {
  return `${formatTime(schedule.startTime)}–${formatTime(schedule.endTime)}`;
}

function formatSessionLine(session: GroupClassSessionWithSchedule): string {
  return `${formatSessionDate(session.date)} · ${formatSessionTimeRange(session.scheduleId)}`;
}

interface BookedInfo {
  childName: string;
  sessionLine: string;
}

export default function BookTrialPage() {
  const { students, reload } = useParentPortal();
  const searchParams = useSearchParams();

  const { data, error, isLoading, retry } = useLoadState(fetchBookingOptions, []);
  const [groupClasses, setGroupClasses] = useState<GroupClass[]>([]);

  useEffect(() => {
    if (data) {
      setGroupClasses(data.groupClasses);
    }
  }, [data]);

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<GroupClassSessionWithSchedule[]>([]);
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
    if (!classId) {
      setSessions([]);
      return;
    }

    let cancelled = false;

    async function loadSessions() {
      setSessionsLoading(true);
      try {
        // Next 30 days, today-inclusive, across ALL of this class's
        // schedules — server-filtered (see backend/src/services/
        // groupClassSession.service.js's listUpcomingByClass), not
        // client-side date math.
        const result = await fetchSessionsByClass(classId);
        if (cancelled) return;

        setSessions(result);
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
  }, [classId]);

  const handleClassChange = useCallback((value: string) => {
    setClassId(value);
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
        sessionLine: selectedSession ? formatSessionLine(selectedSession) : '',
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
              { label: 'Session', value: booked?.sessionLine },
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
        { label: 'Session', value: selectedSession ? formatSessionLine(selectedSession) : '—' },
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

            {classId ? (
              <FlowSection title="Choose a session">
                {sessionsLoading ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Loading sessions...</p>
                ) : sessions.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                    No upcoming trial sessions for this class in the next 30 days.
                  </p>
                ) : (
                  <PillRow
                    items={sessions}
                    selectedKey={sessionId || null}
                    onSelect={setSessionId}
                    getKey={(session) => session._id}
                    getLabel={(session) => formatSessionDate(session.date)}
                    getSub={(session) => formatSessionTimeRange(session.scheduleId)}
                    ariaLabel="Select a session"
                  />
                )}
              </FlowSection>
            ) : null}

            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
          </>
        )}
      </FlowMain>
    </main>
  );
}
