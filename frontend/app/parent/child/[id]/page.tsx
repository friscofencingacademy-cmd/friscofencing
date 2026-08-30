'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../../context/ParentPortalContext';
import { getChildPalette } from '../../../../lib/childPalette';
import { formatTime } from '../../../../lib/formatTime';
import { DAY_LABELS } from '../../../../lib/constants';
import { useLoadState } from '../../../../lib/hooks/useLoadState';
import { fetchSchedules } from '../../../../lib/services/scheduling';
import { formatDateOnly } from '../../../../lib/formatDate';
import type { EnrollmentStatus } from '../../../../lib/types';
import Button from '../../../components/ui/Button/Button';
import styles from './child-detail.module.css';

const VALID_TABS = new Set(['overview', 'schedule']);
type TabKey = 'overview' | 'schedule';

function resolveTab(value: string | null): TabKey {
  return value && VALID_TABS.has(value) ? (value as TabKey) : 'overview';
}

// Presentation only — same split as dashboard/page.tsx's
// enrollmentStatusLabel: the backend (student.service.js's
// attachEnrollment(), docs/plans/frontend-polish-plan.md PR 3) decides
// which of the four states a child is in; these two only map that decision
// to a label/CSS class.
function statusPillLabel(status: EnrollmentStatus): string {
  switch (status) {
    case 'enrolled':
      return 'Enrolled';
    case 'trial_scheduled':
      return 'Trial booked';
    case 'trial_completed':
      return 'Trial completed';
    case 'not_enrolled':
    default:
      return 'Not enrolled';
  }
}

function statusPillClass(status: EnrollmentStatus): string {
  if (status === 'enrolled') return styles.statusPillEnrolled;
  if (status === 'trial_scheduled') return styles.statusPillTrial;
  // trial_completed and not_enrolled both fall back to the plain, unmodified
  // .statusPill — a neutral muted pill, not the crimson "active trial"
  // accent (that would misleadingly suggest a trial is still upcoming).
  return '';
}

export default function ChildDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { students, subscriptions, trialClasses, loading } = useParentPortal();
  // Page-specific option-list fetch, same exception ParentPortalContext's
  // own doc comment already carves out for book-trial/register/payment-
  // method — needed here only to show a premium subscription's full sibling
  // -schedule list, not part of the shared household context's scope.
  const { data: allSchedules } = useLoadState(fetchSchedules, []);

  const tab = resolveTab(searchParams.get('tab'));

  if (loading) {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  const index = students.findIndex((s) => s._id === params.id);
  const student = index === -1 ? undefined : students[index];

  if (!student) {
    return (
      <main>
        <p>Child not found.</p>
        <Link href="/parent/children">Back to My Children</Link>
      </main>
    );
  }

  const palette = getChildPalette(index);
  // DISPLAY-only lookups from here down — the actual subscription/trial ROW
  // this page needs to render schedule/next-billing/session-date details
  // the enrollment object doesn't carry. The ENROLLMENT DECISION itself
  // (status pill, "Not Enrolled" card, CTA gate below) comes from
  // student.enrollment instead — see docs/plans/frontend-polish-plan.md
  // PR 3. Neither of these two lookups gates anything on its own any more.
  const activeSubscription = subscriptions.find(
    (sub) => sub.studentId._id === student._id && sub.status === 'active'
  );
  const trial = trialClasses.find((t) => t.studentId._id === student._id);

  return (
    <main>
      <div className={styles.header}>
        <span className={styles.avatar} style={{ background: palette.gradient }} aria-hidden="true">
          {student.firstName[0]?.toUpperCase() ?? '?'}
        </span>
        <div>
          <h1 className={styles.name}>
            {student.firstName} {student.lastName}
          </h1>
          <div className={styles.metaRow}>
            {/* age is backend-computed (docs/plans/trial-registration-
                required-fields-plan.md §1.5/§2.3) — null/absent on a child
                created before dateOfBirth existed, so it just doesn't
                render, never a guess. */}
            {student.age != null ? <span className={styles.metaLevel}>Age {student.age}</span> : null}
            {student.skillLevel ? <span className={styles.metaLevel}>{student.skillLevel}</span> : null}
            <span className={`${styles.statusPill} ${statusPillClass(student.enrollment.status)}`}>
              {statusPillLabel(student.enrollment.status)}
            </span>
          </div>
        </div>
      </div>

      <nav className={styles.tabs} role="tablist" aria-label="Child detail tabs">
        <Link
          href={`/parent/child/${student._id}?tab=overview`}
          role="tab"
          aria-selected={tab === 'overview'}
          className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
        >
          Overview
        </Link>
        <Link
          href={`/parent/child/${student._id}?tab=schedule`}
          role="tab"
          aria-selected={tab === 'schedule'}
          className={`${styles.tab} ${tab === 'schedule' ? styles.tabActive : ''}`}
        >
          Schedule
        </Link>
      </nav>

      {tab === 'overview' ? (
        <>
          {student.enrollment.status === 'trial_scheduled' && trial ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Trial Class</h2>
              <p>Scheduled for {formatDateOnly(trial.sessionId.date)}.</p>
            </div>
          ) : null}

          {activeSubscription ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Active Registration</h2>
              <p>
                {DAY_LABELS[activeSubscription.scheduleId.dayOfWeek]}{' '}
                {formatTime(activeSubscription.scheduleId.startTime)}-{formatTime(activeSubscription.scheduleId.endTime)}
              </p>
              <p>Next billing date: {formatDateOnly(activeSubscription.nextBillingDate)}</p>
              <Button as="a" href="/parent/subscriptions" variant="secondary" size="sm">
                Manage / Cancel in Billing
              </Button>
            </div>
          ) : null}

          {/* A newly-representable state (docs/plans/frontend-polish-plan.md
              PR 3) — the backend can now tell a PAST trial apart from an
              upcoming one, so there's a real state between "Trial Class"
              and "Not Enrolled" above: the one-trial-ever rule means
              canBookTrial is false here too, so no trial CTA renders —
              Register is the only forward action left. */}
          {student.enrollment.status === 'trial_completed' ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Trial Completed</h2>
              <p>{student.firstName} has already used their free trial class.</p>
              <Button as="a" href={`/parent/register?child=${student._id}`} size="sm">
                Register
              </Button>
            </div>
          ) : null}

          {student.enrollment.canBookTrial ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Not Enrolled</h2>
              <p>{student.firstName} isn&apos;t enrolled in a class yet.</p>
              <Button as="a" href={`/parent/book-trial?child=${student._id}`} size="sm">
                Book a Free Trial
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Schedule</h2>
          {activeSubscription ? (
            activeSubscription.isPremium ? (
              <>
                <p>
                  {student.firstName} is on the premium plan — they can attend any of this level&apos;s scheduled sessions:
                </p>
                <ul>
                  {(allSchedules ?? [])
                    .filter((schedule) => schedule.classId === activeSubscription.scheduleId.classId)
                    .map((schedule) => (
                      <li key={schedule._id}>
                        Every {DAY_LABELS[schedule.dayOfWeek]}, {formatTime(schedule.startTime)} - {formatTime(schedule.endTime)}
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p>
                Every {DAY_LABELS[activeSubscription.scheduleId.dayOfWeek]}, {formatTime(activeSubscription.scheduleId.startTime)}
                {' - '}
                {formatTime(activeSubscription.scheduleId.endTime)}.
              </p>
            )
          ) : (
            <p>{student.firstName} isn&apos;t enrolled in a recurring class yet.</p>
          )}
        </div>
      )}
    </main>
  );
}
