'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { useParentPortal } from '../../../context/ParentPortalContext';
import { getChildPalette } from '../../../../lib/childPalette';
import { formatTime } from '../../../../lib/formatTime';
import { useLoadState } from '../../../../lib/hooks/useLoadState';
import { fetchSchedules } from '../../../../lib/services/scheduling';
import Button from '../../../components/ui/Button/Button';
import styles from './child-detail.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const VALID_TABS = new Set(['overview', 'schedule']);
type TabKey = 'overview' | 'schedule';

function resolveTab(value: string | null): TabKey {
  return value && VALID_TABS.has(value) ? (value as TabKey) : 'overview';
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
  const activeSubscription = subscriptions.find(
    (sub) => sub.studentId._id === student._id && sub.status === 'active'
  );
  const trial = trialClasses.find((t) => t.studentId._id === student._id);
  const hasTrial = !!trial && !activeSubscription;

  const statusLabel = activeSubscription ? 'Enrolled' : hasTrial ? 'Trial booked' : 'Not enrolled';
  const statusClass = activeSubscription ? styles.statusPillEnrolled : hasTrial ? styles.statusPillTrial : '';

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
            {student.skillLevel ? <span className={styles.metaLevel}>{student.skillLevel}</span> : null}
            <span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span>
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
          {hasTrial && trial ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Trial Class</h2>
              <p>Scheduled for {new Date(trial.sessionId.date).toLocaleDateString()}.</p>
            </div>
          ) : null}

          {activeSubscription ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Active Registration</h2>
              <p>
                {DAY_LABELS[activeSubscription.scheduleId.dayOfWeek]}{' '}
                {formatTime(activeSubscription.scheduleId.startTime)}-{formatTime(activeSubscription.scheduleId.endTime)}
              </p>
              <p>Next billing date: {activeSubscription.nextBillingDate.slice(0, 10)}</p>
              <Button as="a" href="/parent/subscriptions" variant="secondary" size="sm">
                Manage / Cancel in Billing
              </Button>
            </div>
          ) : null}

          {!activeSubscription && !hasTrial ? (
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
