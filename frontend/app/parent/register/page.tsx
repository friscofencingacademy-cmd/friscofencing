'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Elements } from '@stripe/react-stripe-js';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels, fetchPrices } from '../../../lib/services/catalog';
import { fetchSessionsByClass } from '../../../lib/services/scheduling';
import {
  createRegistration,
  fetchMyPaymentMethod,
  fetchRegistrationPricePreview,
} from '../../../lib/services/parent';
import { formatTime } from '../../../lib/formatTime';
import stripePromise from '../../../lib/stripe';
import type {
  GroupClass,
  GroupClassSessionWithSchedule,
  Level,
  PaymentMethodInfo,
  Price,
  RegistrationPricePreview,
} from '../../../lib/types';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import LoadError from '../../components/ui/LoadError/LoadError';
import PaymentMethodCardForm from '../../components/portal/PaymentMethodCardForm';
import {
  ChildPickerCards,
  FlowConfirmation,
  FlowMain,
  FlowSection,
  LevelPickerCards,
  OrderSummary,
  PillRow,
} from '../../components/portal/flow';

const STEPS = ['Who', 'Level', 'Done'];

async function fetchRegisterOptions() {
  const [groupClasses, prices, levels, paymentMethod] = await Promise.all([
    fetchGroupClasses(),
    fetchPrices(),
    fetchLevels(),
    fetchMyPaymentMethod(),
  ]);
  return { groupClasses, prices, levels, paymentMethod };
}

function levelName(levels: Level[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

// The ISO date's calendar-day portion only — the backend is the source of
// truth for this date (periodEnd), this is display formatting only.
function formatDateLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A session carries its own schedule's day/time — same helpers as
// /parent/book-trial's session picker, so a date+time reads identically
// everywhere a parent sees one.
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

// ── Start-date window (pure calendar-day math, never billing math) ─────────
// The picker only ever offers "this month" dates, capped at 14 days out —
// and capped EARLIER at the last calendar day of the current month if that
// would otherwise spill into next month. This is a display-window decision
// (how far ahead the picker reaches), not a re-derivation of anything the
// backend computes — the actual prorated/full-price dollar amount for
// whichever date gets picked always comes from GET /registrations/preview
// and the real POST /registrations response, verbatim, same as before.
function thisMonthWindowEnd(today: Date): Date {
  const fourteenDaysOut = new Date(today);
  fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14);

  const endOfThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  endOfThisMonth.setHours(23, 59, 59, 999);

  return fourteenDaysOut < endOfThisMonth ? fourteenDaysOut : endOfThisMonth;
}

// True when `candidate` falls in the calendar month immediately after
// `today`'s — used only to find the one real session "Enroll for next
// month" anchors to, never to compute what it costs.
function isNextCalendarMonth(candidate: Date, today: Date): boolean {
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return candidate.getFullYear() === nextMonthStart.getFullYear() && candidate.getMonth() === nextMonthStart.getMonth();
}

interface RegisteredInfo {
  childName: string;
  startDateLine: string;
  chargeAmount: number;
  totalChargeAmount: number;
  siblingDiscountApplied?: boolean;
  siblingDiscountAmount?: number;
  siblingDiscountReason?: string | null;
  registrationFeeCharged?: number;
  registrationFeeWaived?: boolean;
  registrationFeeReason?: string | null;
  prorated?: boolean;
  totalClassDays?: number | null;
  remainingClassDays?: number | null;
  dailyRate?: number | null;
  periodEnd?: string;
}

export default function RegisterPage() {
  const { students, reload } = useParentPortal();
  const searchParams = useSearchParams();

  const { data, error, isLoading, retry } = useLoadState(fetchRegisterOptions, []);
  const [groupClasses, setGroupClasses] = useState<GroupClass[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null);

  useEffect(() => {
    if (data) {
      setGroupClasses(data.groupClasses);
      setPrices(data.prices);
      setLevels(data.levels);
      setPaymentMethod(data.paymentMethod);
    }
  }, [data]);

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<GroupClassSessionWithSchedule[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<RegisteredInfo | null>(null);
  const [pricePreview, setPricePreview] = useState<RegistrationPricePreview | null>(null);

  // Deep-link preselect: /parent/register?child=<studentId> — skips
  // straight to the Level step, same as picking a child normally does.
  useEffect(() => {
    const preselect = searchParams.get('child');
    if (preselect) {
      setStudentId(preselect);
      setStep(1);
    }
  }, [searchParams]);

  // A level maps 1:1 to a GroupClass in practice (confirmed against real
  // schedule data — className always equals levelName), but the data model
  // doesn't strictly enforce that, so this resolves every class under the
  // selected level (usually exactly one) rather than assuming a single id —
  // the parent never sees "class" as a concept at all (see LevelPickerCards).
  const classIdsForLevel = levelId
    ? groupClasses.filter((groupClass) => groupClass.levelId === levelId).map((groupClass) => groupClass._id)
    : [];

  // Upcoming sessions across every class at the chosen level — the same
  // server-filtered, roster-free endpoint /parent/book-trial's picker uses
  // (backend/src/services/groupClassSession.service.js's listUpcomingByClass),
  // just merged across classIdsForLevel since a level can span more than
  // one class. Picking a session sets BOTH the schedule and the start date
  // at once — there's no separate "choose your time" step any more.
  useEffect(() => {
    if (classIdsForLevel.length === 0) {
      setSessions([]);
      return;
    }

    let cancelled = false;

    async function loadSessions() {
      setSessionsLoading(true);
      try {
        const results = await Promise.all(classIdsForLevel.map((id) => fetchSessionsByClass(id)));
        if (cancelled) return;

        const merged = results
          .flat()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setSessions(merged);
      } catch {
        if (!cancelled) {
          setStepError('Failed to load upcoming class dates.');
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
    // avoids a new-array-every-render dependency.
  }, [levelId, groupClasses]);

  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedPrice = levelId ? prices.find((price) => price.levelId === levelId) ?? null : null;
  const selectedSession = sessionId ? sessions.find((session) => session._id === sessionId) ?? null : null;
  const scheduleId = selectedSession?.scheduleId._id ?? '';
  const startDate = selectedSession?.date ?? '';

  // Split the fetched sessions into "this month" (the picker) and "the
  // earliest real session next month" (what "Enroll for next month"
  // anchors to) — both derived purely from real session data already
  // fetched, never a fabricated/computed date. `now` is read once per
  // render, not memoized — this is a display window, not a value that
  // needs to survive a re-render identically.
  const now = new Date();
  const windowEnd = thisMonthWindowEnd(now);
  const thisMonthSessions = sessions.filter((session) => {
    const date = new Date(session.date);
    return date >= now && date <= windowEnd;
  });
  const nextMonthSession = sessions.find((session) => isNextCalendarMonth(new Date(session.date), now)) ?? null;
  // True exactly when the currently-selected session IS that anchor — i.e.
  // "Enroll for next month" was clicked, not a this-month pill. Purely
  // derived from existing selection state, not a separate flag that could
  // drift out of sync with it.
  const isNextMonthEnrollment = Boolean(sessionId) && nextMonthSession !== null && sessionId === nextMonthSession._id;

  // Live sibling-discount + proration preview as soon as a child, level, and
  // start date are all picked — a non-critical estimate: a failure here is
  // swallowed silently (never a stepError) since the real charge is always
  // correctly computed server-side at submit time regardless of whether this
  // preview loaded.
  useEffect(() => {
    if (!studentId || !scheduleId || !startDate) {
      setPricePreview(null);
      return;
    }

    let cancelled = false;

    fetchRegistrationPricePreview({ studentId, scheduleId, startDate })
      .then((preview) => {
        if (!cancelled) setPricePreview(preview);
      })
      .catch(() => {
        if (!cancelled) setPricePreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [studentId, scheduleId, startDate]);

  // Selecting a child auto-advances straight to the Level step — no
  // separate "Continue" click needed for a step that's just one choice.
  const handleStudentSelect = useCallback((id: string) => {
    setStudentId(id);
    setStep(1);
  }, []);

  const handleLevelChange = useCallback((value: string) => {
    setLevelId(value);
    setSessionId('');
  }, []);

  async function handleSubmit() {
    setStepError(null);
    setSubmitting(true);

    const result = await createRegistration({ studentId, scheduleId, startDate });

    setSubmitting(false);

    if (result.status === 'success') {
      setRegistered({
        childName: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '',
        startDateLine: selectedSession ? formatSessionLine(selectedSession) : '',
        chargeAmount: result.data.chargeAmount,
        totalChargeAmount: result.data.totalChargeAmount,
        siblingDiscountApplied: result.data.siblingDiscountApplied,
        siblingDiscountAmount: result.data.siblingDiscountAmount,
        siblingDiscountReason: result.data.siblingDiscountReason,
        registrationFeeCharged: result.data.registrationFeeCharged,
        registrationFeeWaived: result.data.registrationFeeWaived,
        registrationFeeReason: result.data.registrationFeeReason,
        prorated: result.data.prorated,
        totalClassDays: result.data.totalClassDays,
        remainingClassDays: result.data.remainingClassDays,
        dailyRate: result.data.dailyRate,
        periodEnd: result.data.periodEnd,
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
        <FlowMain crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Register' }]} title="Register" steps={STEPS} current={2} singleColumn>
          <FlowConfirmation
            title="Registration complete!"
            subtitle={`Your card was charged $${registered?.totalChargeAmount.toFixed(2)}.`}
            lines={[
              { label: 'Child', value: registered?.childName },
              { label: 'Start Date', value: registered?.startDateLine },
              ...(registered?.siblingDiscountApplied
                ? [{ label: 'Sibling Discount', value: `-$${registered.siblingDiscountAmount?.toFixed(2)}` }]
                : []),
              // Backend-owned explanation string — shown whenever there's
              // something to say (a discount applied, or one didn't because
              // a sibling already has the lower-priced plan), never derived
              // on the frontend.
              ...(registered?.siblingDiscountReason
                ? [{ label: 'Why', value: registered.siblingDiscountReason }]
                : []),
              // One-time fee, itemized separately — never folded into the
              // recurring monthly amount above.
              ...(registered?.registrationFeeCharged
                ? [{ label: 'Registration Fee (one-time)', value: `$${registered.registrationFeeCharged.toFixed(2)}` }]
                : []),
              ...(registered?.registrationFeeWaived
                ? [{ label: 'Registration Fee', value: 'Waived' }]
                : []),
              // This month's charge was prorated to the class days
              // remaining — never a frontend day count, straight from the
              // backend response. Suppressed for a next-month enrollment:
              // the real numbers there always come out to a full month (the
              // anchor is that month's own first class day), so the
              // day-count sentence would be true but confusing — see
              // isNextMonthEnrollment's own comment above.
              ...(registered?.prorated && !isNextMonthEnrollment
                ? [{ label: 'Prorated', value: `${registered.remainingClassDays} of ${registered.totalClassDays} class days this month` }]
                : []),
              ...(registered?.periodEnd
                ? [
                    {
                      label: isNextMonthEnrollment || !registered?.prorated ? 'Plan renews' : 'Full price starts',
                      value: formatDateLabel(registered.periodEnd),
                    },
                  ]
                : []),
            ]}
            links={
              <>
                <Button as="a" href="/parent/dashboard">
                  Back to Dashboard
                </Button>
                <Button as="a" href="/parent/subscriptions" variant="secondary">
                  View Billing
                </Button>
              </>
            }
          />
        </FlowMain>
      </main>
    );
  }

  const summaryLines = [
    { label: 'Child', value: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—' },
    { label: 'Level', value: levelId ? levelName(levels, levelId) : '—' },
    { label: 'Start Date', value: selectedSession ? formatSessionLine(selectedSession) : '—' },
    { label: 'Monthly Fee', value: selectedPrice ? `$${selectedPrice.monthlyFee}` : '—' },
    ...(pricePreview?.siblingDiscountApplied
      ? [
          { label: 'Sibling Discount', value: `-$${pricePreview.siblingDiscountAmount.toFixed(2)}` },
          { label: "You'll Pay", value: `$${pricePreview.chargeAmount.toFixed(2)}` },
        ]
      : []),
    // This month's charge is prorated to the class days remaining — shown
    // right under "Monthly Fee" so it's clear the full list price above
    // isn't what's actually being charged today. Suppressed for a
    // next-month enrollment — see isNextMonthEnrollment's own comment.
    ...(pricePreview?.prorated && !isNextMonthEnrollment
      ? [{ label: 'Prorated', value: `${pricePreview.remainingClassDays} of ${pricePreview.totalClassDays} class days this month` }]
      : []),
    // One-time fee, itemized separately — never folded into "Monthly Fee"
    // above, so a parent always sees exactly what it's for.
    ...(pricePreview?.registrationFeeCharged
      ? [{ label: 'Registration Fee (one-time)', value: `$${pricePreview.registrationFeeCharged.toFixed(2)}` }]
      : []),
    ...(pricePreview?.registrationFeeCharged || pricePreview?.prorated
      ? [{ label: 'Due Today', value: `$${pricePreview.totalChargeAmount.toFixed(2)}` }]
      : []),
    ...(pricePreview?.periodEnd
      ? [
          {
            label: isNextMonthEnrollment || !pricePreview.prorated ? 'Plan renews' : 'Full price starts',
            value: formatDateLabel(pricePreview.periodEnd),
          },
        ]
      : []),
  ];

  let cta: string;
  let ctaDisabled: boolean;
  let onCta: () => void;

  if (step === 0) {
    cta = 'Continue';
    ctaDisabled = !studentId;
    onCta = () => setStep(1);
  } else {
    cta = 'Register & Pay';
    ctaDisabled = !sessionId || !selectedPrice || !paymentMethod;
    onCta = handleSubmit;
  }

  const summary = (
    <OrderSummary
      lines={summaryLines}
      cta={cta}
      ctaDisabled={ctaDisabled}
      ctaLoading={submitting}
      onCta={onCta}
    />
  );

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Register' }]}
        title="Register for a Class"
        steps={STEPS}
        current={step}
        summary={summary}
      >
        {stepError ? <Alert variant="error">{stepError}</Alert> : null}

        {isLoading ? (
          <p>Loading...</p>
        ) : step === 0 ? (
          <FlowSection title="Who is registering?">
            <ChildPickerCards students={students} selectedId={studentId} onSelect={handleStudentSelect} />
          </FlowSection>
        ) : (
          <>
            <FlowSection title="Choose your level">
              <LevelPickerCards levels={levels} prices={prices} selectedId={levelId} onSelect={handleLevelChange} />
            </FlowSection>

            {levelId ? (
              <FlowSection title="Choose your start date">
                {sessionsLoading ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Loading upcoming dates...</p>
                ) : sessions.length === 0 ? (
                  <Alert variant="error">No upcoming class dates are available for this level yet.</Alert>
                ) : (
                  <>
                    {thisMonthSessions.length > 0 ? (
                      <PillRow
                        items={thisMonthSessions}
                        selectedKey={sessionId || null}
                        onSelect={setSessionId}
                        getKey={(session) => session._id}
                        getLabel={(session) => formatSessionDate(session.date)}
                        getSub={(session) => formatSessionTimeRange(session.scheduleId)}
                        ariaLabel="Select a start date"
                      />
                    ) : (
                      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                        No class dates available in the next two weeks this month.
                      </p>
                    )}

                    <div style={{ marginTop: '0.75rem' }}>
                      <Button
                        type="button"
                        variant={isNextMonthEnrollment ? 'primary' : 'secondary'}
                        size="sm"
                        disabled={!nextMonthSession}
                        onClick={() => nextMonthSession && setSessionId(nextMonthSession._id)}
                      >
                        Enroll for next month
                      </Button>
                      {nextMonthSession ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                          First class: {formatSessionLine(nextMonthSession)}
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                          Next month's schedule isn't posted yet — check back soon.
                        </p>
                      )}
                    </div>
                  </>
                )}
                {pricePreview?.siblingDiscountApplied ? (
                  <p>10% sibling discount applied — ${pricePreview.chargeAmount.toFixed(2)}/month</p>
                ) : pricePreview?.siblingDiscountReason ? (
                  <p>{pricePreview.siblingDiscountReason}</p>
                ) : null}
                {pricePreview && isNextMonthEnrollment ? (
                  <p>Full monthly price — ${pricePreview.totalChargeAmount.toFixed(2)} due today.</p>
                ) : pricePreview?.prorated ? (
                  <p>
                    {pricePreview.remainingClassDays} of {pricePreview.totalClassDays} class days remain this
                    month — ${pricePreview.dailyRate?.toFixed(2)}/day → ${pricePreview.totalChargeAmount.toFixed(2)}{' '}
                    due today. Full price starts {formatDateLabel(pricePreview.periodEnd)}.
                  </p>
                ) : null}
              </FlowSection>
            ) : null}

            {sessionId ? (
              <FlowSection title="Payment method">
                {paymentMethod ? (
                  <p>
                    Card on file: {paymentMethod.cardBrand} ending in {paymentMethod.cardLast4} — this card will
                    be charged.
                  </p>
                ) : (
                  <Elements stripe={stripePromise}>
                    <PaymentMethodCardForm onSaved={setPaymentMethod} submitLabel="Add Card" />
                  </Elements>
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
