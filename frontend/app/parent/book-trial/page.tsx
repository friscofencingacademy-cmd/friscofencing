'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels } from '../../../lib/services/catalog';
import { fetchSessionsByClass } from '../../../lib/services/scheduling';
import { bookTrialClass } from '../../../lib/services/parent';
import { formatTime } from '../../../lib/formatTime';
import { formatDateOnly } from '../../../lib/formatDate';
import type { GroupClass, GroupClassSessionWithSchedule, Level } from '../../../lib/types';
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

const STEPS = ['Who', 'Pick a Level', 'Confirmation'];

async function fetchBookingOptions() {
  const [groupClasses, levels] = await Promise.all([fetchGroupClasses(), fetchLevels()]);
  return { groupClasses, levels };
}

// A session carries its own schedule's day/time now (no separate schedule
// selection) — both the pill picker and the summary/confirmation derive
// their display strings from the session itself, never a cross-referenced
// schedule list. session.date is a calendar-day sentinel (docs/plans/
// utc-date-standard-plan.md) — rendered via formatDateOnly (UTC-anchored),
// never a bare toLocaleDateString, which renders the wrong day for any
// viewer in a browser timezone west of UTC.
function formatSessionDate(dateIso: string): string {
  return formatDateOnly(dateIso, { weekday: 'short' });
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
  const [levels, setLevels] = useState<Level[]>([]);

  useEffect(() => {
    if (data) {
      setGroupClasses(data.groupClasses);
      setLevels(data.levels);
    }
  }, [data]);

  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState('');
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

  // A level maps 1:1 to a GroupClass in practice (confirmed against real
  // schedule data — className always equals levelName), but the data model
  // doesn't strictly enforce that — a GroupClass's own `name` is an
  // independent field that goes stale the moment a Level is renamed without
  // also renaming its class. This step used to show that stale class name
  // directly; it now resolves every class under the selected level (usually
  // exactly one) rather than assuming a single id, and shows the level's own
  // (always-live) name instead — the parent never sees "class" as a concept
  // at all, matching register/page.tsx's identical LevelPickerCards pattern.
  const classIdsForLevel = levelId
    ? groupClasses.filter((groupClass) => groupClass.levelId === levelId).map((groupClass) => groupClass._id)
    : [];

  useEffect(() => {
    if (classIdsForLevel.length === 0) {
      setSessions([]);
      return;
    }

    let cancelled = false;

    async function loadSessions() {
      setSessionsLoading(true);
      try {
        // Next 30 days, today-inclusive, merged across every class at the
        // chosen level — server-filtered per class (see backend/src/
        // services/groupClassSession.service.js's listUpcomingByClass), not
        // client-side date math. Same merge pattern as register/page.tsx.
        const results = await Promise.all(classIdsForLevel.map((id) => fetchSessionsByClass(id)));
        if (cancelled) return;

        const merged = results
          .flat()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setSessions(merged);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- classIdsForLevel
    // is recomputed fresh every render from levelId + the stable groupClasses
    // array; depending on levelId + groupClasses directly is equivalent and
    // avoids a new-array-every-render dependency (same rationale as
    // register/page.tsx's identical effect).
  }, [levelId, groupClasses]);

  const handleLevelChange = useCallback((value: string) => {
    setLevelId(value);
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

  if (booked) {
    return (
      <main>
        <FlowMain crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Book a Trial' }]} title="Book a Trial" steps={STEPS} current={2} singleColumn>
          <FlowConfirmation
            title="Trial class booked!"
            subtitle="We look forward to seeing you."
            lines={[
              { label: 'Child', value: booked.childName },
              { label: 'Session', value: booked.sessionLine },
            ]}
            links={
              <Button as="a" href="/parent/dashboard">
                Back to Dashboard
              </Button>
            }
          />
        </FlowMain>
      </main>
    );
  }

  // Derived, not stored — the stepper reflects how far the parent has
  // gotten through the sequential form below, never a separately-tracked
  // "current step" that could drift out of sync with it.
  const currentStep = studentId ? 1 : 0;

  const summary = (
    <OrderSummary
      lines={[
        { label: 'Child', value: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—' },
        { label: 'Session', value: selectedSession ? formatSessionLine(selectedSession) : '—' },
      ]}
      cta="Book Trial Class"
      ctaDisabled={!sessionId}
      ctaLoading={submitting}
      onCta={handleSubmit}
    />
  );

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Book a Trial' }]}
        title="Book a Trial"
        steps={STEPS}
        current={currentStep}
        summary={summary}
      >
        {stepError ? <Alert variant="error">{stepError}</Alert> : null}

        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <>
            <FlowSection title="Who is this trial for?">
              <ChildPickerCards students={students} selectedId={studentId} onSelect={setStudentId} />
            </FlowSection>

            {studentId ? (
              <FlowSection title="Choose a level">
                <select
                  aria-label="Level"
                  value={levelId}
                  onChange={(e) => handleLevelChange(e.target.value)}
                  required
                >
                  <option value="">Select a level</option>
                  {levels.map((level) => (
                    <option key={level._id} value={level._id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </FlowSection>
            ) : null}

            {levelId ? (
              <FlowSection title="Choose a session">
                {sessionsLoading ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Loading sessions...</p>
                ) : sessions.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                    No upcoming trial sessions for this level in the next 30 days.
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
          </>
        )}
      </FlowMain>
    </main>
  );
}
