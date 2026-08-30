'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, ClipboardList, Wallet } from 'lucide-react';

import { useParentPortal } from '../../context/ParentPortalContext';
import { getChildPalette } from '../../../lib/childPalette';
import { formatTime } from '../../../lib/formatTime';
import { DAY_LABELS } from '../../../lib/constants';
import type { StudentEnrollment } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import AddChildModal from '../../components/portal/AddChildModal';
import styles from './dashboard.module.css';

// Presentation only — the ENROLLMENT DECISION (which of these four states a
// student is in, and whether the trial CTA should show) is the backend's
// (student.service.js's attachEnrollment(), docs/plans/frontend-polish-
// plan.md PR 3). This function only maps an already-decided status to a
// label string and formats the schedule fields it's handed; it never
// scans subscriptions/trialClasses itself.
function enrollmentStatusLabel(enrollment: StudentEnrollment): string {
  switch (enrollment.status) {
    case 'enrolled': {
      const schedule = enrollment.schedule;
      // Always present when status is 'enrolled', except the rare case the
      // backend's own schedule reference degraded (orphaned ref) — render a
      // safe fallback rather than crash on a null schedule.
      return schedule
        ? `Enrolled — ${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)}`
        : 'Enrolled';
    }
    case 'trial_scheduled':
      return 'Trial class scheduled';
    case 'trial_completed':
      return 'Trial completed';
    case 'not_enrolled':
    default:
      return 'Not enrolled';
  }
}

export default function ParentDashboardPage() {
  const { students, loading, reload } = useParentPortal();
  const [addChildOpen, setAddChildOpen] = useState(false);

  if (loading) {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  if (students.length === 0) {
    return (
      <main>
        <div className={styles.onboarding}>
          <h1 className={styles.onboardingTitle}>Welcome to Frisco Fencing Academy</h1>
          <p className={styles.onboardingSubtitle}>Let&apos;s get your family started.</p>

          <div className={styles.stepper}>
            <div className={`${styles.step} ${styles.stepDone}`}>
              <span className={styles.stepCircle}>✓</span>
              <span className={styles.stepLabel}>Account Created</span>
            </div>
            <div className={`${styles.step} ${styles.stepCurrent}`}>
              <span className={styles.stepCircle}>2</span>
              <span className={styles.stepLabel}>Add Your Child</span>
              <Button type="button" size="sm" onClick={() => setAddChildOpen(true)}>
                Add Child
              </Button>
            </div>
            <div className={styles.step}>
              <span className={styles.stepCircle}>3</span>
              <span className={styles.stepLabel}>Book a Trial</span>
            </div>
          </div>
        </div>

        {addChildOpen ? (
          <AddChildModal
            onClose={() => setAddChildOpen(false)}
            onSuccess={() => {
              setAddChildOpen(false);
              reload();
            }}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main>
      <div className={styles.grid}>
        <div className={styles.childCards}>
          {students.map((student, index) => {
            const palette = getChildPalette(index);

            return (
              <Card key={student._id}>
                <div className={styles.childCard}>
                  <Link href={`/parent/child/${student._id}`} className={styles.childCardLink}>
                    <span className={styles.childCardAvatar} style={{ background: palette.gradient }} aria-hidden="true">
                      {student.firstName[0]?.toUpperCase() ?? '?'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <p className={styles.childCardName}>
                        {student.firstName} {student.lastName}
                      </p>
                      <p className={styles.childCardStatus}>{enrollmentStatusLabel(student.enrollment)}</p>
                    </div>
                  </Link>
                  {student.enrollment.canBookTrial ? (
                    <Button as="a" href="/parent/book-trial" variant="secondary" size="sm">
                      Book a free trial →
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>

        <div>
          <Card>
            <h2>Quick Actions</h2>
            <div className={styles.quickActions}>
              <Button as="a" href="/parent/book-trial" variant="secondary" fullWidth>
                <CalendarPlus size={16} /> Book Trial
              </Button>
              <Button as="a" href="/parent/register" variant="secondary" fullWidth>
                <ClipboardList size={16} /> Register
              </Button>
              <Button as="a" href="/parent/payment-method" variant="secondary" fullWidth>
                <Wallet size={16} /> Payment Method
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
