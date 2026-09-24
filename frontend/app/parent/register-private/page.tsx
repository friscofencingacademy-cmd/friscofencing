'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  bookPrivateLessonWithCredit,
  fetchPrivateAvailableDates,
  fetchPrivatePurchaseQuote,
  fetchPublicPrivateLessons,
  purchasePrivateLessons,
} from '../../../lib/services/privateClass';
import { fetchMyPaymentMethod } from '../../../lib/services/parent';
import { formatMoney } from '../../../lib/formatMoney';
import {
  formatLessonClock,
  formatLessonDay,
  formatLessonTime,
  formatRuleSlot,
  sessionCount,
} from '../../../lib/privateLessons';
import type {
  PrivateAvailableDate,
  PrivateBookingResult,
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
// who -> which date of the chosen slot -> use a paid session or buy 1 / a
// pack -> review & pay -> done. Every price, credit count, bookable date and
// the cancellation cutoff is a backend value; this page only formats them.

const STEPS = ['Who', 'When', 'Sessions', 'Review', 'Done'];
const CREDIT_CHOICE = 'credit';

function purchaseKey(option: PrivatePurchaseOption): string {
  return `buy-${option.quantity}`;
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

export default function RegisterPrivatePage() {
  const { students } = useParentPortal();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [day, setDay] = useState('');
  const [choice, setChoice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [booked, setBooked] = useState<PrivateBookingResult | null>(null);

  // Deep links: /parent/register-private?slot=<scheduleId>&child=<studentId>&day=<YYYY-MM-DD>
  useEffect(() => {
    const slotParam = searchParams.get('slot');
    const childParam = searchParams.get('child');
    const dayParam = searchParams.get('day');
    if (slotParam) setScheduleId(slotParam);
    if (childParam) setStudentId(childParam);
    if (dayParam) setDay(dayParam);
  }, [searchParams]);

  const catalog = useLoadState(fetchCatalogAndCard, []);
  const dates = useLoadState<PrivateAvailableDate[]>(
    () => (scheduleId ? fetchPrivateAvailableDates(scheduleId) : Promise.resolve([])),
    [scheduleId]
  );
  const quote = useLoadState(
    () => (studentId && scheduleId ? fetchPrivatePurchaseQuote(studentId, scheduleId) : Promise.resolve(null)),
    [studentId, scheduleId]
  );

  const found = catalog.data && scheduleId ? findSlot(catalog.data.coaches, scheduleId) : null;
  const paymentMethod = catalog.data ? catalog.data.paymentMethod : null;
  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedDate = dates.data ? dates.data.find((candidate) => candidate.day === day) ?? null : null;
  const purchaseOption =
    quote.data && choice !== CREDIT_CHOICE
      ? quote.data.options.find((option) => purchaseKey(option) === choice) ?? null
      : null;
  const usingCredit = choice === CREDIT_CHOICE;

  function goTo(nextStep: number) {
    setSubmitError(null);
    setStep(nextStep);
  }

  function pickAnotherDate() {
    setDay('');
    dates.retry();
    goTo(1);
  }

  async function handleSubmit() {
    if (!selectedDate || (!usingCredit && !purchaseOption)) return;

    setSubmitError(null);
    setSubmitting(true);

    const result = usingCredit
      ? await bookPrivateLessonWithCredit({ studentId, scheduleId, day })
      : await purchasePrivateLessons({ studentId, scheduleId, day, quantity: purchaseOption!.quantity });

    setSubmitting(false);

    if (result.status === 'success') {
      setBooked(result.data);
      setStep(4);
    } else {
      setSubmitError(result.message);
      // The server's own answers may have changed (a slot taken, a credit
      // used elsewhere) — refetch before the parent tries again.
      dates.retry();
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
      value: selectedDate ? formatLessonTime(selectedDate.startDate) : found ? formatRuleSlot(found.slot) : '—',
    },
  ];

  if (usingCredit) {
    summaryLines.push({ label: 'Paid with', value: 'A session you already bought' });
  } else if (purchaseOption) {
    summaryLines.push({
      label: 'Sessions',
      value: `${purchaseOption.quantity} × ${formatMoney(purchaseOption.unitPrice)}`,
    });
    if (purchaseOption.discountPercent > 0) {
      summaryLines.push({
        label: `Pack discount (${purchaseOption.discountPercent}%)`,
        value: `−${formatMoney(purchaseOption.discountAmount)}`,
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
    ctaDisabled = !studentId || !found;
    onCta = () => goTo(1);
  } else if (step === 1) {
    cta = 'Continue';
    ctaDisabled = !selectedDate;
    onCta = () => goTo(2);
  } else if (step === 2) {
    cta = 'Continue';
    ctaDisabled = !usingCredit && !purchaseOption;
    onCta = () => goTo(3);
  } else {
    cta = usingCredit ? 'Book with a paid session' : purchaseOption ? `Pay ${formatMoney(purchaseOption.total)} & book` : 'Book';
    ctaDisabled = submitting || needsCard || !selectedDate || (!usingCredit && !purchaseOption);
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
        {!scheduleId ? (
          <p style={{ marginTop: 'var(--space-3)' }}>
            No time picked yet — <Link href="/private-classes">browse private lesson times</Link>.
          </p>
        ) : !found ? (
          <Alert variant="error">
            That time is no longer offered. <Link href="/private-classes">Browse private lesson times</Link>.
          </Alert>
        ) : (
          <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-muted)' }}>
            {found.coach.coachName} — {formatRuleSlot(found.slot)}
          </p>
        )}
      </FlowSection>
    );
  } else if (step === 1) {
    content = (
      <FlowSection title="Pick a date">
        {dates.error ? (
          <LoadError message={getErrorMessage(dates.error)} onRetry={dates.retry} compact />
        ) : dates.isLoading ? (
          <p>Loading dates...</p>
        ) : !dates.data || dates.data.length === 0 ? (
          <p>
            No open dates for this time right now. <Link href="/private-classes">Pick another time</Link>.
          </p>
        ) : (
          <PillRow
            items={dates.data}
            selectedKey={day || null}
            onSelect={setDay}
            getKey={(date) => date.day}
            getLabel={(date) => formatLessonDay(date.startDate)}
            getSub={(date) => formatLessonClock(date.startDate)}
            ariaLabel="Select a date"
          />
        )}
      </FlowSection>
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
                label: `Buy ${sessionCount(option.quantity)}`,
                sub:
                  option.discountAmount > 0
                    ? `${formatMoney(option.total)} · save ${formatMoney(option.discountAmount)}`
                    : formatMoney(option.total),
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
        {selectedDate && found ? (
          <p>
            {childName} with {found.coach.coachName} on <strong>{formatLessonTime(selectedDate.startDate)}</strong> (
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
