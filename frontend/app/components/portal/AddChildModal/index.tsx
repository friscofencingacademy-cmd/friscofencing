'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { createStudent } from '../../../../lib/services/parent';
import type { SkillLevel } from '../../../../lib/types';
import Alert from '../../ui/Alert/Alert';
import Button from '../../ui/Button/Button';
import styles from './AddChildModal.module.css';
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
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }

    setSubmitting(true);
    const result = await createStudent({ firstName, lastName, skillLevel });
    setSubmitting(false);

    if (result.status === 'success') {
      onSuccess();
    } else {
      setError(result.message);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className={styles.dialog} role="dialog" aria-label="Add Child">
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>Add Child</h2>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className={styles.dialogBody}>
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
        </div>
        <div className={styles.dialogFooter}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Child'}
          </Button>
        </div>
      </div>
    </div>
  );
}
