'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../context/ParentPortalContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels, fetchPrices } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import { createRegistration, fetchMyPaymentMethod } from '../../../lib/services/parent';
import { formatTime } from '../../../lib/formatTime';
import type { GroupClass, GroupClassSchedule, Level, PaymentMethodInfo, Price } from '../../../lib/types';
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

const STEPS = ['Who', 'Class', 'Review & Pay', 'Done'];
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
  const [classId, setClassId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<RegisteredInfo | null>(null);

  // Deep-link preselect: /parent/register?child=<studentId>
  useEffect(() => {
    const preselect = searchParams.get('child');
    if (preselect) {
      setStudentId(preselect);
    }
  }, [searchParams]);

  const filteredSchedules = classId ? schedules.filter((schedule) => schedule.classId === classId) : [];

  const handleClassChange = useCallback((value: string) => {
    setClassId(value);
    setScheduleId('');
  }, []);

  const selectedStudent = students.find((student) => student._id === studentId);
  const selectedGroupClass = classId ? groupClasses.find((groupClass) => groupClass._id === classId) ?? null : null;
  const selectedPrice = selectedGroupClass ? prices.find((price) => price.levelId === selectedGroupClass.levelId) ?? null : null;
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
            lines={[{ label: 'Child', value: registered?.childName }]}
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
    { label: 'Class', value: selectedGroupClass?.name ?? '—' },
    {
      label: 'Schedule',
      value: selectedSchedule ? `${DAY_LABELS[selectedSchedule.dayOfWeek]} ${formatTime(selectedSchedule.startTime)}-${formatTime(selectedSchedule.endTime)}` : '—',
    },
    { label: 'Monthly Fee', value: selectedPrice ? `$${selectedPrice.monthlyFee}` : '—' },
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
            <FlowSection title="Choose a class">
              <select aria-label="Class" value={classId} onChange={(e) => handleClassChange(e.target.value)} required>
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
                onChange={(e) => setScheduleId(e.target.value)}
                required
                disabled={!classId}
              >
                <option value="">Select a schedule</option>
                {filteredSchedules.map((schedule) => (
                  <option key={schedule._id} value={schedule._id}>
                    {DAY_LABELS[schedule.dayOfWeek]} {formatTime(schedule.startTime)}-{formatTime(schedule.endTime)}
                  </option>
                ))}
              </select>
              {selectedGroupClass ? (
                selectedPrice ? (
                  <p>
                    Level: {levelName(levels, selectedGroupClass.levelId)} — ${selectedPrice.monthlyFee}/month
                  </p>
                ) : (
                  <Alert variant="error">Pricing is not configured for this class yet.</Alert>
                )
              ) : null}
            </FlowSection>

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
