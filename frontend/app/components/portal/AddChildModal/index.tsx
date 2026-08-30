'use client';

import { useState } from 'react';

import { createStudent } from '../../../../lib/services/parent';
import type { SkillLevel } from '../../../../lib/types';
import Alert from '../../ui/Alert/Alert';
import Button from '../../ui/Button/Button';
import Modal from '../../ui/Modal/Modal';
import shared from '../../ui/shared.module.css';

export interface AddChildModalProps {
  /** Called when the user cancels or dismisses the dialog without saving. */
  onClose: () => void;
  /** Called after the child is successfully created — the caller reloads household data and closes. */
  onSuccess: () => void;
}

export default function AddChildModal({ onClose, onSuccess }: AddChildModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }

    // Required here (docs/plans/trial-registration-required-fields-plan.md
    // §1.3) — the backend itself doesn't hard-require it (admin's own
    // dialog may not always have it in hand), but a parent adding their own
    // child is exactly the moment to collect it, since it's what unblocks
    // booking a trial class later.
    if (!dateOfBirth) {
      setError("Child's date of birth is required.");
      return;
    }

    setSubmitting(true);
    const result = await createStudent({ firstName, lastName, skillLevel, dateOfBirth });
    setSubmitting(false);

    if (result.status === 'success') {
      onSuccess();
    } else {
      setError(result.message);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Child"
      disableClose={submitting}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Child'}
          </Button>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className={shared.formField}>
        <label htmlFor="add-child-firstName" className={shared.formLabel}>
          First Name
        </label>
        <input
          id="add-child-firstName"
          className={shared.formInput}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
      </div>
      <div className={shared.formField}>
        <label htmlFor="add-child-lastName" className={shared.formLabel}>
          Last Name
        </label>
        <input
          id="add-child-lastName"
          className={shared.formInput}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </div>
      <div className={shared.formField}>
        <label htmlFor="add-child-dateOfBirth" className={shared.formLabel}>
          Date of Birth
        </label>
        <input
          id="add-child-dateOfBirth"
          type="date"
          className={shared.formInput}
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          required
        />
      </div>
      <div className={shared.formField}>
        <label htmlFor="add-child-skillLevel" className={shared.formLabel}>
          Skill Level
        </label>
        <select
          id="add-child-skillLevel"
          className={shared.formSelect}
          value={skillLevel}
          onChange={(e) => setSkillLevel(e.target.value as SkillLevel)}
          required
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>
    </Modal>
  );
}
