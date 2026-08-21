'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, ClipboardList, Wallet } from 'lucide-react';

import { useParentPortal } from '../../context/ParentPortalContext';
import { getChildPalette } from '../../../lib/childPalette';
import type { Subscription } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import AddChildModal from '../../components/portal/AddChildModal';
import styles from './dashboard.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function statusLine(activeSubscription: Subscription | undefined, hasTrial: boolean): string {
  if (activeSubscription) {
    const schedule = activeSubscription.scheduleId;
    return `Enrolled — ${DAY_LABELS[schedule.dayOfWeek]} ${schedule.startTime}-${schedule.endTime}`;
  }

  if (hasTrial) {
    return 'Trial class scheduled';
  }

  return 'Not enrolled';
}

export default function ParentDashboardPage() {
  const { students, subscriptions, trialClasses, loading, reload } = useParentPortal();
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
            const activeSubscription = subscriptions.find(
              (sub) => sub.studentId._id === student._id && sub.status === 'active'
            );
            const hasTrial = trialClasses.some((trial) => trial.studentId._id === student._id);
            const notEnrolled = !activeSubscription && !hasTrial;

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
                      <p className={styles.childCardStatus}>{statusLine(activeSubscription, hasTrial)}</p>
                    </div>
                  </Link>
                  {notEnrolled ? (
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
