'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import { DAY_LABELS } from '../../../lib/constants';
import {
  formatDateOnly,
  todayInAcademyTZ,
  sentinelCalendarDay,
  calendarDayOrdinal,
  addCalendarDays,
  lastDayOfMonth,
  nextCalendarMonth,
  type CalendarDay,
} from '../../../lib/formatDate';
import stripePromise from '../../../lib/stripe';
import type {
  GroupClass,
  GroupClassSessionWithSchedule,
  Level,
  PaymentMethodInfo,
  Price,
  RegistrationPreviewSavings,
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
import type { OrderSummaryLine } from '../../components/portal/flow';

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

// periodEnd is a calendar-day sentinel — the backend is the source of truth
// for this date, this is display formatting only. formatDateOnly renders it
// UTC-anchored, never browser-local (docs/plans/utc-date-standard-plan.md).
function formatDateLabel(isoDate: string): string {
  return formatDateOnly(isoDate);
}

// A session carries its own schedule's day/time — same helpers as
// /parent/book-trial's session picker, so a date+time reads identically
// everywhere a parent sees one. session.date is a calendar-day sentinel.
function formatSessionDate(dateIso: string): string {
  return formatDateOnly(dateIso, { weekday: 'short' });
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
//
// Every comparison here happens on CalendarDay tuples (docs/plans/
// utc-date-standard-plan.md), never on `Date` objects built from a session
// sentinel via local getters — `new Date(session.date).getMonth()` reads a
// UTC-midnight sentinel through browser-local time, which silently shifts
// it onto the wrong calendar day for any viewer west of UTC (the same bug
// class as the raw-toLocaleDateString rendering bug this plan also fixes).
// `today` is `todayInAcademyTZ()` — the academy's own "today," never the
// viewer's browser-local one — read once per render, not memoized, since
// this is a display window, not a value that needs to survive a re-render
// identically.
function thisMonthWindowEnd(today: CalendarDay): CalendarDay {
  const fourteenDaysOut = addCalendarDays(today, 14);
  const endOfThisMonth = lastDayOfMonth(today);

  return calendarDayOrdinal(fourteenDaysOut) < calendarDayOrdinal(endOfThisMonth) ? fourteenDaysOut : endOfThisMonth;
}

// True when `candidate` falls in the calendar month immediately after
// `today`'s — used only to find the one real session "Enroll for next
// month" anchors to, never to compute what it costs.
function isNextCalendarMonth(candidate: CalendarDay, today: CalendarDay): boolean {
  const nextMonth = nextCalendarMonth(today);
  return candidate.year === nextMonth.year && candidate.month === nextMonth.month;
}

interface RegisteredInfo {
  childName: string;
  startDateLine: string;
  chargeAmount: number;
  totalChargeAmount: number;
  // 'completed' | 'pending' (docs/decisions/008-registration-create-
  // pending-first.md) — 'pending' means the registration was accepted but
  // the first charge attempt failed and is now retrying automatically.
  paymentStatus: 'completed' | 'pending';
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
  savings?: RegistrationPreviewSavings;
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

  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<GroupClassSessionWithSchedule[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<RegisteredInfo | null>(null);
  const [pricePreview, setPricePreview] = useState<RegistrationPricePreview | null>(null);

  // Deep-link preselect: /parent/register?child=<studentId> — the Level
  // section below appears automatically once studentId is set, same as
  // picking a child normally does.
  useEffect(() => {
    const preselect = searchParams.get('child');
    if (preselect) {
      setStudentId(preselect);
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
  // Server-decided (student.service.js's attachEnrollment(), see
  // docs/features/parent-portal.md) — never derived from
  // subscriptions/trialClasses here. Optional-chained throughout below:
  // enrollment is always present on a real /students/mine response, but
  // this stays defensive rather than assuming every caller/fixture sends
  // it (docs/plans/booking-and-private-class-fixes-plan.md §1).
  const alreadyEnrolled = selectedStudent?.enrollment?.status === 'enrolled';
  // Built from the full `Student[]` (never a StudentBase cast) so
  // ChildPickerCards' getBadge callback — typed against the narrower
  // StudentBase it actually accepts — can look a student up by id without
  // reading a field its own prop type doesn't carry.
  const enrolledStudentIds = new Set(
    students.filter((student) => student.enrollment?.status === 'enrolled').map((student) => student._id)
  );
  const selectedPrice = levelId ? prices.find((price) => price.levelId === levelId) ?? null : null;
  const selectedSession = sessionId ? sessions.find((session) => session._id === sessionId) ?? null : null;
  const scheduleId = selectedSession?.scheduleId._id ?? '';
  const startDate = selectedSession?.date ?? '';

  // Split the fetched sessions into "this month" (the picker) and "the
  // earliest real session next month" (what "Enroll for next month"
  // anchors to) — both derived purely from real session data already
  // fetched, never a fabricated/computed date.
  const today = todayInAcademyTZ();
  const todayOrdinal = calendarDayOrdinal(today);
  const windowEndOrdinal = calendarDayOrdinal(thisMonthWindowEnd(today));
  const thisMonthSessions = sessions.filter((session) => {
    const ordinal = calendarDayOrdinal(sentinelCalendarDay(session.date));
    return ordinal >= todayOrdinal && ordinal <= windowEndOrdinal;
  });
  const nextMonthSession =
    sessions.find((session) => isNextCalendarMonth(sentinelCalendarDay(session.date), today)) ?? null;
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
        paymentStatus: result.data.paymentStatus,
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
        savings: result.data.savings,
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

  if (registered) {
    return (
      <main>
        <FlowMain crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Register' }]} title="Register" steps={STEPS} current={2} singleColumn>
          <FlowConfirmation
            title={registered?.paymentStatus === 'pending' ? 'Registration received' : 'Registration complete!'}
            subtitle={
              registered?.paymentStatus === 'pending'
                ? "We couldn't charge your card just now — we'll automatically retry over the next few days, and email you if we need anything from you."
                : `Your card was charged $${registered?.totalChargeAmount.toFixed(2)}.`
            }
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
              // Family Scorecard checkout quote panel (docs/plans/
              // wordpress-ui-alignment-plan.md, Phase 3) — the combined
              // sibling-discount + waived-fee savings, straight from the
              // backend's own sum (no arithmetic here). Omitted entirely
              // when there was nothing to save.
              ...(registered?.savings && registered.savings.total > 0
                ? [{ label: 'You Saved', value: `$${registered.savings.total.toFixed(2)}` }]
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

  // Derived, not stored — the stepper reflects how far the parent has
  // gotten through the sequential form below, never a separately-tracked
  // "current step" that could drift out of sync with it.
  const currentStep = studentId ? 1 : 0;

  // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
  // alignment-plan.md, Phase 3) — every dollar amount and savings figure
  // below is read straight from pricePreview, never computed here (Hard
  // Rule 7); `kind` only chooses OrderSummary's presentation.
  // Family-breakdown footnote (docs/plans/booking-flow-sequential-plan.md,
  // owner's exact ask) — shown only when the sibling-discount row itself is
  // shown, so a family with no discount never sees a footnote with nothing
  // to explain.
  const SIBLING_DISCOUNT_NOTE =
    '* The 10% sibling discount always applies to the lower-priced plan in your family — the higher-priced plan is billed in full.';

  const summaryLines: OrderSummaryLine[] = [
    { label: 'Child', value: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—' },
    { label: 'Level', value: levelId ? levelName(levels, levelId) : '—' },
    { label: 'Start Date', value: selectedSession ? formatSessionLine(selectedSession) : '—' },
    { label: 'Monthly Fee', value: selectedPrice ? `$${selectedPrice.monthlyFee}` : '—' },
    // Family breakdown — every active sibling's own current plan, listed
    // above the discount line so it's clear where the 10% is coming from
    // (owner's ask: "show parents where the calculation is coming from").
    // siblingComparison is undefined against a backend that predates this
    // field — falls back to no rows, never a crash.
    ...(pricePreview?.siblingDiscountApplied
      ? (pricePreview.siblingComparison ?? []).map((sibling) => ({
          label: `${sibling.studentName} — current plan`,
          value: `$${sibling.monthlyFee}/mo`,
        }))
      : []),
    ...(pricePreview?.siblingDiscountApplied
      ? [
          {
            label:
              pricePreview.discountBase != null
                ? `Sibling Discount (10% of $${pricePreview.discountBase.toFixed(2)})*`
                : 'Sibling Discount',
            value: `-$${pricePreview.siblingDiscountAmount.toFixed(2)}`,
            kind: 'discount' as const,
          },
          { label: "You'll Pay", value: `$${pricePreview.chargeAmount.toFixed(2)}` },
        ]
      : []),
    // This month's charge is prorated to the class days remaining, at the
    // per-day rate — shown right under "Monthly Fee" so it's clear the full
    // list price above isn't what's actually being charged today.
    // Suppressed for a next-month enrollment — see isNextMonthEnrollment's
    // own comment.
    ...(pricePreview?.prorated && !isNextMonthEnrollment
      ? [
          {
            label: 'Prorated',
            value:
              pricePreview.dailyRate != null
                ? `${pricePreview.remainingClassDays} of ${pricePreview.totalClassDays} class days · $${pricePreview.dailyRate.toFixed(2)}/day`
                : `${pricePreview.remainingClassDays} of ${pricePreview.totalClassDays} class days this month`,
          },
        ]
      : []),
    // One-time fee, itemized separately — never folded into "Monthly Fee"
    // above, so a parent always sees exactly what it's for.
    ...(pricePreview?.registrationFeeCharged
      ? [{ label: 'Registration Fee (one-time)', value: `$${pricePreview.registrationFeeCharged.toFixed(2)}` }]
      : []),
    ...(pricePreview?.registrationFeeWaived
      ? [
          { label: 'Registration Fee', value: 'Waived', kind: 'discount' as const },
          ...(pricePreview.registrationFeeReason
            ? [{ label: 'Why', value: pricePreview.registrationFeeReason, kind: 'note' as const }]
            : []),
        ]
      : []),
    // The one number a parent actually needs to walk away with — always
    // shown once a preview has loaded, even when it's identical to
    // "Monthly Fee" above (no discount/proration/fee to explain the
    // difference); a scorecard states the bottom line outright rather than
    // making the parent add it up themselves.
    ...(pricePreview
      ? [{ label: 'Due at enrollment', value: `$${pricePreview.totalChargeAmount.toFixed(2)}`, kind: 'total' as const }]
      : []),
    ...(pricePreview?.savings && pricePreview.savings.total > 0
      ? [{ label: 'You Save', value: `$${pricePreview.savings.total.toFixed(2)}`, kind: 'discount' as const }]
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

  const summary = (
    <OrderSummary
      lines={summaryLines}
      cta="Register & Pay"
      ctaDisabled={!sessionId || !selectedPrice || !paymentMethod}
      ctaLoading={submitting}
      onCta={handleSubmit}
      note={pricePreview?.siblingDiscountApplied ? SIBLING_DISCOUNT_NOTE : undefined}
    />
  );

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Register' }]}
        title="Register for a Class"
        steps={STEPS}
        current={currentStep}
        summary={summary}
      >
        {stepError ? <Alert variant="error">{stepError}</Alert> : null}

        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <>
            <FlowSection title="Who is registering?">
              <ChildPickerCards
                students={students}
                selectedId={studentId}
                onSelect={setStudentId}
                getBadge={(student) => (enrolledStudentIds.has(student._id) ? 'Already enrolled' : null)}
              />
            </FlowSection>

            {studentId && alreadyEnrolled ? (
              // Surfaced here — the moment a child is picked — rather than
              // only at the final Register & Pay step, where the backend's
              // one-active-subscription-per-student guard (ADR 005) would
              // otherwise be the parent's first sign of it (docs/plans/
              // booking-and-private-class-fixes-plan.md §1). The Level/
              // start-date/payment sections below simply never mount for
              // this child — levelId stays unset.
              <FlowSection title="Already enrolled">
                <p>
                  {selectedStudent?.firstName} is already enrolled
                  {selectedStudent?.enrollment?.schedule
                    ? ` — Every ${DAY_LABELS[selectedStudent.enrollment.schedule.dayOfWeek]}, ${formatTime(
                        selectedStudent.enrollment.schedule.startTime
                      )} – ${formatTime(selectedStudent.enrollment.schedule.endTime)}.`
                    : // Orphaned schedule reference (parent-portal.md's
                      // degradation contract) — still says enrolled, just
                      // without a day/time line, never a crash.
                      '.'}
                </p>
                <p>
                  Manage or cancel this registration in{' '}
                  <Link href="/parent/subscriptions">My Registrations</Link>.
                </p>
              </FlowSection>
            ) : studentId ? (
              <FlowSection title="Choose your level">
                <LevelPickerCards levels={levels} prices={prices} selectedId={levelId} onSelect={handleLevelChange} />
              </FlowSection>
            ) : null}

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
          </>
        )}
      </FlowMain>
    </main>
  );
}
