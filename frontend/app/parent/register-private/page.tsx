'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  bookPrivateLessonWithCredit,
  fetchPrivatePurchaseQuote,
  fetchPublicPrivateLessons,
  purchasePrivateLessons,
} from '../../../lib/services/privateClass';
import { fetchCoachOpenPrivateSlots } from '../../../lib/services/calendar';
import { fetchMyPaymentMethod } from '../../../lib/services/parent';
import { formatMoney } from '../../../lib/formatMoney';
import {
  formatLessonClock,
  formatLessonDay,
  formatLessonTime,
  formatWindowLabel,
  groupAvailabilityWindows,
  purchaseOptionLabel,
  purchaseOptionPrice,
} from '../../../lib/privateLessons';
import type {
  PrivateBookingResult,
  PrivateOpenSlot,
  PrivatePurchaseOption,
  PublicPrivateClassCoach,
  PublicPrivateClassSlot,
} from '../../../lib/types';
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
import type { OrderSummaryLine } from '../../components/portal/flow';

// Booking a private lesson (docs/decisions/011-private-per-session-booking.md):
// who -> a date, then a time, inside the chosen availability window -> use a
// paid session or buy 1 / a pack -> review & pay -> done. Every price, credit
// count, open slot and the cancellation cutoff is a backend value; this page
// only formats them.

const STEPS = ['Who', 'When', 'Sessions', 'Review', 'Done'];
const CREDIT_CHOICE = 'credit';

// A purchase option is identified by its packId (null = the single session),
// never by its quantity or price (docs/plans/coach-pack-pricing-plan.md D4).
function purchaseKey(option: PrivatePurchaseOption): string {
  return option.packId ? `pack-${option.packId}` : 'single';
}

async function fetchCatalogAndCard() {
  const [lessons, paymentMethod] = await Promise.all([fetchPublicPrivateLessons(), fetchMyPaymentMethod()]);
  return { coaches: lessons.coaches, paymentMethod };
}

function findSlot(
  coaches: PublicPrivateClassCoach[],
  scheduleId: string
): { coach: PublicPrivateClassCoach; slot: PublicPrivateClassSlot } | null {
  for (const coach of coaches) {
    const slot = coach.slots.find((candidate) => candidate.scheduleId === scheduleId);
    if (slot) return { coach, slot };
  }
  return null;
}

interface OpenDay {
  day: string;
  firstStartsAt: string;
  count: number;
}

// The window's open slots, one entry per day, in date order.
function openDaysOf(slots: PrivateOpenSlot[]): OpenDay[] {
  const byDay = new Map<string, OpenDay>();
  [...slots]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .forEach((slot) => {
      const entry = byDay.get(slot.day);
      if (entry) entry.count += 1;
      else byDay.set(slot.day, { day: slot.day, firstStartsAt: slot.startsAt, count: 1 });
    });
  return [...byDay.values()];
}

export default function RegisterPrivatePage() {
  const { students } = useParentPortal();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  // The slot the parent arrived with (?slot=) — it names the availability
  // window to book in. `scheduleId` is the time picked inside that window.
  const [entrySlotId, setEntrySlotId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [day, setDay] = useState('');
  const [choice, setChoice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [booked, setBooked] = useState<PrivateBookingResult | null>(null);

  // Deep links: /parent/register-private?slot=<scheduleId>&child=<studentId>&day=<YYYY-MM-DD>
  // `slot` alone opens its window; with `day` (a calendar click) that exact
  // slot and day are picked too.
  useEffect(() => {
    const slotParam = searchParams.get('slot');
    const childParam = searchParams.get('child');
    const dayParam = searchParams.get('day');
    if (slotParam) setEntrySlotId(slotParam);
    if (slotParam && dayParam) setScheduleId(slotParam);
    if (childParam) setStudentId(childParam);
    if (dayParam) setDay(dayParam);
  }, [searchParams]);

  const catalog = useLoadState(fetchCatalogAndCard, []);
  const found = catalog.data && entrySlotId ? findSlot(catalog.data.coaches, entrySlotId) : null;
  // The window (back-to-back slots of one coach, weekday, length and range)
  // the entry slot belongs to — every time offered below is one of its slots.
  const slotWindow = found
    ? groupAvailabilityWindows(found.coach.slots, () => found.coach.coachId).find((candidate) =>
        candidate.rules.some((rule) => rule.scheduleId === entrySlotId)
      ) ?? null
    : null;
  const coachId = found ? found.coach.coachId : '';

  const openSlots = useLoadState<PrivateOpenSlot[]>(
    () => (coachId ? fetchCoachOpenPrivateSlots(coachId) : Promise.resolve([])),
    [coachId]
  );
  const quote = useLoadState(
    () => (studentId && scheduleId ? fetchPrivatePurchaseQuote(studentId, scheduleId) : Promise.resolve(null)),
    [studentId, scheduleId]
  );

  const windowSlotIds = new Set(slotWindow ? slotWindow.rules.map((rule) => rule.scheduleId) : []);
  const windowSlots = (openSlots.data ?? []).filter((slot) => windowSlotIds.has(slot.scheduleId));
  const openDays = openDaysOf(windowSlots);
  const timesForDay = windowSlots
    .filter((slot) => slot.day === day)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const paymentMethod = catalog.data ? catalog.data.paymentMethod : null;
  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedSlot = timesForDay.find((slot) => slot.scheduleId === scheduleId) ?? null;
  const purchaseOption =
    quote.data && choice !== CREDIT_CHOICE
      ? quote.data.options.find((option) => purchaseKey(option) === choice) ?? null
      : null;
  const usingCredit = choice === CREDIT_CHOICE;

  function goTo(nextStep: number) {
    setSubmitError(null);
    setStep(nextStep);
  }

  function pickDay(nextDay: string) {
    setDay(nextDay);
    setScheduleId('');
  }

  function pickAnotherDate() {
    pickDay('');
    openSlots.retry();
    goTo(1);
  }

  async function handleSubmit() {
    if (!selectedSlot || (!usingCredit && (!purchaseOption || !quote.data || !quote.data.contractId))) return;

    setSubmitError(null);
    setSubmitting(true);

    const result = usingCredit
      ? await bookPrivateLessonWithCredit({ studentId, scheduleId, day })
      : await purchasePrivateLessons({
          studentId,
          scheduleId,
          day,
          // The contract version these prices came from (plan §8 V5).
          contractId: quote.data!.contractId!,
          ...(purchaseOption!.packId ? { packId: purchaseOption!.packId } : {}),
        });

    setSubmitting(false);

    if (result.status === 'success') {
      setBooked(result.data);
      setStep(4);
    } else {
      setSubmitError(result.message);
      // The server's own answers may have changed (a slot taken, a credit
      // used elsewhere, prices changed or a pack no longer offered — plan
      // D11, §8 V5) — refetch before the parent tries again, through this
      // one error path.
      openSlots.retry();
      quote.retry();
    }
  }

  if (catalog.error) {
    return (
      <main>
        <LoadError message={getErrorMessage(catalog.error)} onRetry={catalog.retry} />
      </main>
    );
  }

  const childName = selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—';

  if (step === 4 && booked) {
    return (
      <main>
        <FlowMain
          crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Private Lessons' }]}
          title="Private Lessons"
          steps={STEPS}
          current={4}
          singleColumn
        >
          <FlowConfirmation
            title="You're booked!"
            subtitle="A confirmation is on its way to your email."
            lines={[
              { label: 'Child', value: childName },
              { label: 'Lesson', value: formatLessonTime(booked.session.startDate) },
              { label: 'Sessions left', value: String(booked.remaining) },
            ]}
            links={
              <>
                <Button as="a" href="/private-classes">
                  Book another lesson
                </Button>
                <Button as="a" href="/parent/subscriptions" variant="secondary">
                  My Lessons
                </Button>
              </>
            }
          />
        </FlowMain>
      </main>
    );
  }

  // ── Summary rail (the single CTA for each step lives here) ────────────────
  const summaryLines: OrderSummaryLine[] = [
    { label: 'Child', value: childName },
    { label: 'Coach', value: found ? found.coach.coachName : '—' },
    {
      label: 'Lesson',
      value: selectedSlot ? formatLessonTime(selectedSlot.startsAt) : slotWindow ? formatWindowLabel(slotWindow) : '—',
    },
  ];

  if (usingCredit) {
    summaryLines.push({ label: 'Paid with', value: 'A session you already bought' });
  } else if (purchaseOption) {
    summaryLines.push({
      label: 'Sessions',
      value: `${purchaseOption.quantity} × ${formatMoney(purchaseOption.unitPrice)}`,
    });
    if (purchaseOption.savings > 0) {
      summaryLines.push({
        label: 'Pack savings',
        value: `−${formatMoney(purchaseOption.savings)}`,
        kind: 'discount',
      });
    }
    summaryLines.push({ label: 'Due today', value: formatMoney(purchaseOption.total), kind: 'total' });
  }

  const needsCard = step === 3 && !usingCredit && !paymentMethod;

  let cta: string;
  let ctaDisabled: boolean;
  let onCta: () => void;

  if (step === 0) {
    cta = 'Continue';
    ctaDisabled = !studentId || !slotWindow;
    onCta = () => goTo(1);
  } else if (step === 1) {
    cta = 'Continue';
    ctaDisabled = !selectedSlot;
    onCta = () => goTo(2);
  } else if (step === 2) {
    cta = 'Continue';
    ctaDisabled = !usingCredit && !purchaseOption;
    onCta = () => goTo(3);
  } else {
    cta = usingCredit ? 'Book with a paid session' : purchaseOption ? `Pay ${formatMoney(purchaseOption.total)} & book` : 'Book';
    ctaDisabled = submitting || needsCard || !selectedSlot || (!usingCredit && !purchaseOption);
    onCta = handleSubmit;
  }

  const summary = (
    <OrderSummary lines={summaryLines} cta={cta} ctaDisabled={ctaDisabled} ctaLoading={submitting} onCta={onCta} />
  );

  // ── Step content ──────────────────────────────────────────────────────────
  let content;

  if (catalog.isLoading) {
    content = <p>Loading...</p>;
  } else if (step === 0) {
    content = (
      <FlowSection title="Who is this for?">
        <ChildPickerCards students={students} selectedId={studentId} onSelect={setStudentId} />
        {!entrySlotId ? (
          <p style={{ marginTop: 'var(--space-3)' }}>
            No time picked yet — <Link href="/private-classes">browse private lesson times</Link>.
          </p>
        ) : !found || !slotWindow ? (
          <Alert variant="error">
            That time is no longer offered. <Link href="/private-classes">Browse private lesson times</Link>.
          </Alert>
        ) : (
          <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-muted)' }}>
            {found.coach.coachName} — {formatWindowLabel(slotWindow)} · {slotWindow.durationMinutes}-min lessons
          </p>
        )}
      </FlowSection>
    );
  } else if (step === 1) {
    content = (
      <>
        <FlowSection title="Pick a date">
          {openSlots.error ? (
            <LoadError message={getErrorMessage(openSlots.error)} onRetry={openSlots.retry} compact />
          ) : openSlots.isLoading ? (
            <p>Loading dates...</p>
          ) : openDays.length === 0 ? (
            <p>
              No open dates for these times right now. <Link href="/private-classes">Pick another time</Link>.
            </p>
          ) : (
            <PillRow
              items={openDays}
              selectedKey={day || null}
              onSelect={pickDay}
              getKey={(openDay) => openDay.day}
              getLabel={(openDay) => formatLessonDay(openDay.firstStartsAt)}
              getSub={(openDay) => `${openDay.count} open`}
              ariaLabel="Select a date"
            />
          )}
        </FlowSection>

        {day && !openSlots.isLoading && !openSlots.error ? (
          <FlowSection title="Pick a time">
            {timesForDay.length === 0 ? (
              <p>No open times on that date — pick another date.</p>
            ) : (
              <PillRow
                items={timesForDay}
                selectedKey={scheduleId || null}
                onSelect={setScheduleId}
                getKey={(slot) => slot.scheduleId}
                getLabel={(slot) => formatLessonClock(slot.startsAt)}
                ariaLabel="Select a time"
              />
            )}
          </FlowSection>
        ) : null}
      </>
    );
  } else if (step === 2) {
    const credits = quote.data ? quote.data.availableCredits : 0;
    const options = quote.data ? quote.data.options : [];

    content = (
      <FlowSection title="How many sessions?">
        {quote.error ? (
          <LoadError message={getErrorMessage(quote.error)} onRetry={quote.retry} compact />
        ) : quote.isLoading || !quote.data ? (
          <p>Loading prices...</p>
        ) : credits === 0 && options.length === 0 ? (
          <Alert variant="error">This coach isn&apos;t taking new bookings right now.</Alert>
        ) : (
          <PillRow
            items={[
              ...(credits > 0 ? [{ key: CREDIT_CHOICE, label: 'Use a paid session', sub: `${credits} left` }] : []),
              ...options.map((option) => ({
                key: purchaseKey(option),
                label: purchaseOptionLabel(option),
                sub: purchaseOptionPrice(option),
              })),
            ]}
            selectedKey={choice || null}
            onSelect={setChoice}
            getKey={(item) => item.key}
            getLabel={(item) => item.label}
            getSub={(item) => item.sub}
            ariaLabel="Select how to pay"
          />
        )}
      </FlowSection>
    );
  } else {
    content = (
      <FlowSection title="Review">
        {selectedSlot && found ? (
          <p>
            {childName} with {found.coach.coachName} on <strong>{formatLessonTime(selectedSlot.startsAt)}</strong> (
            {found.slot.durationMinutes} min).
          </p>
        ) : null}

        {usingCredit ? (
          <p>This uses one of the sessions you already paid for. No card charge.</p>
        ) : needsCard ? (
          <Alert variant="error">
            Add a payment method before booking — do that <Link href="/parent/payment-method">here</Link>.
          </Alert>
        ) : paymentMethod ? (
          <p>
            Card on file: {paymentMethod.cardBrand} ending in {paymentMethod.cardLast4}
          </p>
        ) : null}

        {quote.data ? (
          <p style={{ color: 'var(--color-muted)' }}>
            A missed lesson uses a session. Cancel at least {quote.data.cancelCutoffHours} hours before a lesson to get
            the session back. Payments are not refunded.
          </p>
        ) : null}
      </FlowSection>
    );
  }

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Private Lessons' }]}
        title="Book a Private Lesson"
        steps={STEPS}
        current={step}
        summary={summary}
      >
        {submitError ? (
          <Alert variant="error">
            {submitError}{' '}
            <button
              type="button"
              onClick={pickAnotherDate}
              style={{ textDecoration: 'underline', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              Pick another date
            </button>
          </Alert>
        ) : null}

        {content}

        {step > 0 ? (
          <Button type="button" variant="secondary" onClick={() => goTo(step - 1)} disabled={submitting}>
            Back
          </Button>
        ) : null}
      </FlowMain>
    </main>
  );
}
