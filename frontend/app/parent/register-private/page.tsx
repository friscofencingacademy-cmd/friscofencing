'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchPublicPrivateClassCoaches, createPrivateEnrollment } from '../../../lib/services/privateClass';
import { fetchMyPaymentMethod } from '../../../lib/services/parent';
import type { PaymentMethodInfo, PublicPrivateClassCoach, PublicPrivateClassSlot } from '../../../lib/types';
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

const STEPS = ['Who', 'Review & Pay', 'Done'];

async function fetchRegisterPrivateOptions() {
  const [coaches, paymentMethod] = await Promise.all([
    fetchPublicPrivateClassCoaches(),
    fetchMyPaymentMethod(),
  ]);
  return { coaches, paymentMethod };
}

function findSlot(
  coaches: PublicPrivateClassCoach[],
  scheduleId: string
): { coach: PublicPrivateClassCoach; slot: PublicPrivateClassSlot } | null {
  for (const coach of coaches) {
    const slot = coach.slots.find((s) => s.scheduleId === scheduleId);
    if (slot) return { coach, slot };
  }
  return null;
}

function formatFirstSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function RegisterPrivatePage() {
  const { students, reload } = useParentPortal();
  const searchParams = useSearchParams();

  const { data, error, isLoading, retry } = useLoadState(fetchRegisterPrivateOptions, []);
  const [coaches, setCoaches] = useState<PublicPrivateClassCoach[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null);

  useEffect(() => {
    if (data) {
      setCoaches(data.coaches);
      setPaymentMethod(data.paymentMethod);
    }
  }, [data]);

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ childName: string; sessionPrice: number } | null>(null);

  // Deep links: /parent/register-private?child=<studentId>&slot=<scheduleId>
  useEffect(() => {
    const childParam = searchParams.get('child');
    if (childParam) setStudentId(childParam);

    const slotParam = searchParams.get('slot');
    if (slotParam) setScheduleId(slotParam);
  }, [searchParams]);

  const selectedStudent = students.find((student) => student._id === studentId);
  const found = scheduleId ? findSlot(coaches, scheduleId) : null;

  async function handleSubmit() {
    if (!found) return;

    setStepError(null);
    setSlotTaken(false);
    setSubmitting(true);

    const result = await createPrivateEnrollment({ studentId, scheduleId });

    setSubmitting(false);

    if (result.status === 'success') {
      setConfirmed({
        childName: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '',
        sessionPrice: result.data.sessionPrice,
      });
      setStep(2);
      reload();
    } else {
      setStepError(result.message);
      if (result.message.toLowerCase().includes('just taken')) {
        setSlotTaken(true);
      }
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
        <FlowMain
          crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Private Lessons' }]}
          title="Private Lessons"
          steps={STEPS}
          current={2}
          singleColumn
        >
          <FlowConfirmation
            title="You're booked!"
            subtitle={`You'll be charged $${confirmed?.sessionPrice.toFixed(2)} after each completed session.`}
            lines={[{ label: 'Child', value: confirmed?.childName }]}
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
          <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
            You&apos;ll get a confirmation email shortly.
          </p>
        </FlowMain>
      </main>
    );
  }

  const noPaymentMethod = step === 1 && !paymentMethod;

  let cta: string;
  let ctaDisabled: boolean;
  let onCta: () => void;

  if (step === 0) {
    cta = 'Continue';
    ctaDisabled = !studentId || !scheduleId;
    onCta = () => setStep(1);
  } else {
    cta = 'Confirm Booking';
    ctaDisabled = noPaymentMethod || !found || submitting;
    onCta = handleSubmit;
  }

  const summaryLines = [
    { label: 'Child', value: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '—' },
    { label: 'Coach', value: found?.coach.coachName ?? '—' },
    {
      label: 'Slot',
      value: found ? `${found.slot.dayName} · ${found.slot.displayTime} · ${found.slot.durationMinutes} min` : '—',
    },
    { label: 'Per session', value: found ? `$${found.slot.sessionPrice.toFixed(2)}` : '—' },
  ];

  const summary = (
    <OrderSummary lines={summaryLines} cta={cta} ctaDisabled={ctaDisabled} ctaLoading={submitting} onCta={onCta} />
  );

  return (
    <main>
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Private Lessons' }]}
        title="Register for Private Lessons"
        steps={STEPS}
        current={step}
        summary={summary}
      >
        {stepError ? (
          <Alert variant="error">
            {stepError}
            {slotTaken ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => {
                    setStepError(null);
                    setSlotTaken(false);
                    setScheduleId('');
                    setStep(0);
                    retry();
                  }}
                  style={{ textDecoration: 'underline', border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
                >
                  Refresh available slots
                </button>
              </>
            ) : null}
          </Alert>
        ) : null}

        {isLoading ? (
          <p>Loading...</p>
        ) : step === 0 ? (
          <FlowSection title="Who is this for?">
            <ChildPickerCards students={students} selectedId={studentId} onSelect={setStudentId} />

            {!scheduleId ? (
              <p style={{ marginTop: 'var(--space-3)' }}>
                No slot selected yet — <Link href="/private-classes">browse available slots</Link>.
              </p>
            ) : !found ? (
              <Alert variant="error">
                That slot is no longer available. <Link href="/private-classes">Browse available slots</Link>.
              </Alert>
            ) : (
              <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-muted)' }}>
                Slot: {found.coach.coachName} — {found.slot.dayName} {found.slot.displayTime}
              </p>
            )}
          </FlowSection>
        ) : (
          <>
            <FlowSection title="Review & Pay">
              {found ? (
                <p>
                  First session {formatFirstSessionDate(found.slot.firstSessionDate)}. You&apos;ll be charged{' '}
                  <strong>${found.slot.sessionPrice.toFixed(2)} after each completed session</strong> to your
                  saved card.
                </p>
              ) : null}

              {noPaymentMethod ? (
                <Alert variant="error">
                  You&apos;ll need to add a payment method before registering — do that{' '}
                  <Link href="/parent/payment-method">here</Link>.
                </Alert>
              ) : (
                <p>
                  Card on file: {paymentMethod?.cardBrand} ending in {paymentMethod?.cardLast4}
                </p>
              )}
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
