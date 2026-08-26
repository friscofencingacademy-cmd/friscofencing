'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels, fetchPrices } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import {
  createRegistration,
  fetchMyPaymentMethod,
  fetchRegistrationPricePreview,
} from '../../../lib/services/parent';
import { formatTime } from '../../../lib/formatTime';
import type {
  GroupClass,
  GroupClassSchedule,
  Level,
  PaymentMethodInfo,
  Price,
  RegistrationPricePreview,
} from '../../../lib/types';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import LoadError from '../../components/ui/LoadError/LoadError';
import {
  ChildPickerCards,
  FlowConfirmation,
  FlowMain,
  FlowSection,
  LevelPickerCards,
  OrderSummary,
  PillRow,
} from '../../components/portal/flow';

const STEPS = ['Who', 'Level', 'Review & Pay', 'Done'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function fetchRegisterOptions() {
  const [groupClasses, schedules, prices, levels, paymentMethod] = await Promise.all([
    fetchGroupClasses(),
    fetchSchedules(),
    fetchPrices(),
    fetchLevels(),
    fetchMyPaymentMethod(),
  ]);
  return { groupClasses, schedules, prices, levels, paymentMethod };
}

function levelName(levels: Level[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

interface RegisteredInfo {
  childName: string;
  chargeAmount: number;
  siblingDiscountApplied?: boolean;
  siblingDiscountAmount?: number;
  siblingDiscountReason?: string | null;
}

export default function RegisterPage() {
  const { students, reload } = useParentPortal();
  const searchParams = useSearchParams();

  const { data, error, isLoading, retry } = useLoadState(fetchRegisterOptions, []);
  const [groupClasses, setGroupClasses] = useState<GroupClass[]>([]);
  const [schedules, setSchedules] = useState<GroupClassSchedule[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null);

  useEffect(() => {
    if (data) {
      setGroupClasses(data.groupClasses);
      setSchedules(data.schedules);
      setPrices(data.prices);
      setLevels(data.levels);
      setPaymentMethod(data.paymentMethod);
    }
  }, [data]);

  const [step, setStep] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<RegisteredInfo | null>(null);
  const [pricePreview, setPricePreview] = useState<RegistrationPricePreview | null>(null);

  // Deep-link preselect: /parent/register?child=<studentId>
  useEffect(() => {
    const preselect = searchParams.get('child');
    if (preselect) {
      setStudentId(preselect);
    }
  }, [searchParams]);

  // Live sibling-discount preview as soon as both a child and a schedule are
  // picked — a non-critical estimate: a failure here is swallowed silently
  // (never a stepError) since the real charge is always correctly computed
  // server-side at submit time regardless of whether this preview loaded.
  useEffect(() => {
    if (!studentId || !scheduleId) {
      setPricePreview(null);
      return;
    }

    let cancelled = false;

    fetchRegistrationPricePreview({ studentId, scheduleId })
      .then((preview) => {
        if (!cancelled) setPricePreview(preview);
      })
      .catch(() => {
        if (!cancelled) setPricePreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [studentId, scheduleId]);

  // A level maps 1:1 to a GroupClass in practice (confirmed against real
  // schedule data — className always equals levelName), but the data model
  // doesn't strictly enforce that, so this resolves every class under the
  // selected level (usually exactly one) rather than assuming a single id —
  // robust either way, and the parent never sees "class" as a concept at
  // all any more (see LevelPickerCards).
  const classIdsForLevel = levelId
    ? groupClasses.filter((groupClass) => groupClass.levelId === levelId).map((groupClass) => groupClass._id)
    : [];
  const filteredSchedules = schedules.filter((schedule) => classIdsForLevel.includes(schedule.classId));

  const handleLevelChange = useCallback((value: string) => {
    setLevelId(value);
    setScheduleId('');
  }, []);

  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedPrice = levelId ? prices.find((price) => price.levelId === levelId) ?? null : null;
  const selectedSchedule = scheduleId ? schedules.find((schedule) => schedule._id === scheduleId) ?? null : null;

  async function handleSubmit() {
    setStepError(null);
    setSubmitting(true);

    // Payment-critical: request payload/sequencing stays byte-identical to
    // the pre-wizard implementation — this is the exact same
    // createRegistration({ studentId, scheduleId }) mutation call.
    const result = await createRegistration({ studentId, scheduleId });

    setSubmitting(false);

    if (result.status === 'success') {
      setRegistered({
        childName: selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : '',
        chargeAmount: result.data.chargeAmount,
        siblingDiscountApplied: result.data.siblingDiscountApplied,
        siblingDiscountAmount: result.data.siblingDiscountAmount,
        siblingDiscountReason: result.data.siblingDiscountReason,
      });
      setStep(3);
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

  if (step === 3) {
    return (
      <main>
        <FlowMain crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Register' }]} title="Register" steps={STEPS} current={3} singleColumn>
          <FlowConfirmation
            title="Registration complete!"
            subtitle={`Your card was charged $${registered?.chargeAmount.toFixed(2)}.`}
            lines={[
              { label: 'Child', value: registered?.childName },
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
    {
      label: 'Usual time',
      value: selectedSchedule ? `${DAY_LABELS[selectedSchedule.dayOfWeek]} ${formatTime(selectedSchedule.startTime)}-${formatTime(selectedSchedule.endTime)}` : '—',
    },
    { label: 'Monthly Fee', value: selectedPrice ? `$${selectedPrice.monthlyFee}` : '—' },
    ...(pricePreview?.siblingDiscountApplied
      ? [
          { label: 'Sibling Discount', value: `-$${pricePreview.siblingDiscountAmount.toFixed(2)}` },
          { label: "You'll Pay", value: `$${pricePreview.chargeAmount.toFixed(2)}` },
        ]
      : []),
  ];

  const noPaymentMethod = step === 2 && !paymentMethod;

  let cta: string;
  let ctaDisabled: boolean;
  let onCta: () => void;

  if (step === 0) {
    cta = 'Continue';
    ctaDisabled = !studentId;
    onCta = () => setStep(1);
  } else if (step === 1) {
    cta = 'Continue';
    ctaDisabled = !scheduleId || !selectedPrice;
    onCta = () => setStep(2);
  } else {
    cta = 'Register & Pay';
    ctaDisabled = noPaymentMethod;
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
            <ChildPickerCards students={students} selectedId={studentId} onSelect={setStudentId} />
          </FlowSection>
        ) : step === 1 ? (
          <>
            <FlowSection title="Choose your level">
              <LevelPickerCards levels={levels} prices={prices} selectedId={levelId} onSelect={handleLevelChange} />
            </FlowSection>

            {levelId ? (
              <FlowSection title="Choose your preferred time">
                <p>
                  You&apos;re enrolling in the full {levelName(levels, levelId)} program — you can attend any of
                  its scheduled sessions. Pick one below as your usual time.
                </p>
                {filteredSchedules.length === 0 ? (
                  <Alert variant="error">No time slots are available for this level yet.</Alert>
                ) : (
                  <PillRow
                    items={filteredSchedules}
                    selectedKey={scheduleId || null}
                    onSelect={setScheduleId}
                    getKey={(schedule) => schedule._id}
                    getLabel={(schedule) => `${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)}`}
                    ariaLabel="Select a time"
                  />
                )}
                {pricePreview?.siblingDiscountApplied ? (
                  <p>10% sibling discount applied — ${pricePreview.chargeAmount.toFixed(2)}/month</p>
                ) : pricePreview?.siblingDiscountReason ? (
                  <p>{pricePreview.siblingDiscountReason}</p>
                ) : null}
              </FlowSection>
            ) : null}

            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <FlowSection title="Review">
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

            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
          </>
        )}
      </FlowMain>
    </main>
  );
}
