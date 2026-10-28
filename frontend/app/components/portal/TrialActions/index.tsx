'use client';

import { useState } from 'react';

import { cancelTrialClass } from '../../../../lib/services/parent';
import { formatInstantRange } from '../../../../lib/formatDate';
import type { Student } from '../../../../lib/types';
import Alert from '../../ui/Alert/Alert';
import Button from '../../ui/Button/Button';
import Modal from '../../ui/Modal/Modal';
import styles from './TrialActions.module.css';

export interface TrialActionsProps {
  student: Student;
  /** Called after a successful cancel, so the page reloads the household. */
  onCancelled: () => void;
}

// Reschedule / Cancel for a child's upcoming trial (docs/plans/trial-cancel-
// reschedule-plan.md). The one home for both actions, used by the parent
// dashboard and the child detail page. Whether they show is the server's
// enrollment.trial.canChange alone — the same rule PATCH/DELETE
// /trial-classes/:id enforce — never a date comparison here. A page left
// open past the class start still gets the server's refusal, shown inline.
export default function TrialActions({ student, onCancelled }: TrialActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const { status, trial } = student.enrollment;

  if (status !== 'trial_scheduled' || !trial || !trial.canChange) {
    return null;
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setCancelError(null);
  }

  async function confirmCancel() {
    if (!trial) return;

    setCancelling(true);
    setCancelError(null);

    const result = await cancelTrialClass(trial._id);

    setCancelling(false);

    if (result.status === 'success') {
      setConfirmOpen(false);
      onCancelled();
    } else {
      setCancelError(result.message);
    }
  }

  return (
    <>
      <div className={styles.actions}>
        <Button as="a" href={`/parent/book-trial?reschedule=${student._id}`} variant="secondary" size="sm">
          Reschedule trial
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
          Cancel trial
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Cancel Trial"
        size="sm"
        hideCloseButton
        disableClose={cancelling}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeConfirm} disabled={cancelling}>
              Keep Trial
            </Button>
            <Button type="button" variant="danger" onClick={confirmCancel} loading={cancelling}>
              Cancel Trial
            </Button>
          </>
        }
      >
        {cancelError ? <Alert variant="error">{cancelError}</Alert> : null}
        <p className={styles.confirmText}>
          Cancel {student.firstName}&apos;s free trial on {formatInstantRange(trial.startsAt, trial.endsAt)}? You can book
          a new trial afterwards.
        </p>
      </Modal>
    </>
  );
}
