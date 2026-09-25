'use client';

import {
  emptyPackRow,
  type PackEditorRow,
  type PackRowStatus,
} from '../../../../lib/hooks/useContractPreview';
import adminStyles from '../admin.module.css';
import styles from './PackEditor.module.css';

// The ONE private-lesson pack editor (docs/plans/coach-pack-pricing-plan.md
// D14 e) — the Packs section of the coach-contract dialog. Presentational
// (§8 V7): it renders the rows and each row's status line; the preview,
// the debounce and the Save gate live in useContractPreview.

interface PackEditorProps {
  rows: PackEditorRow[];
  onChange: (rows: PackEditorRow[]) => void;
  statusFor: (row: PackEditorRow) => PackRowStatus;
  disabled?: boolean;
  defaultMinutes?: string;
}

export default function PackEditor({ rows, onChange, statusFor, disabled = false, defaultMinutes = '' }: PackEditorProps) {
  function setRow(key: string, field: 'sessionDurationMinutes' | 'quantity' | 'price', value: string) {
    onChange(rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  return (
    <div className={adminStyles.formGroup}>
      <span className={adminStyles.label}>Packs</span>
      <p className={adminStyles.formHint}>
        A fixed price for a number of lessons of one length. A single lesson at the hourly rate is always
        offered.
      </p>

      {rows.map((row, index) => {
        const label = `Pack ${index + 1}`;
        const status = statusFor(row);

        return (
          <div key={row.key} className={styles.pack}>
            <div className={styles.row}>
              <input
                aria-label={`${label} lesson length (min)`}
                type="number"
                min={15}
                step={1}
                className={adminStyles.input}
                placeholder="Minutes"
                value={row.sessionDurationMinutes}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'sessionDurationMinutes', e.target.value)}
              />
              <input
                aria-label={`${label} sessions`}
                type="number"
                min={2}
                step={1}
                className={adminStyles.input}
                placeholder="Sessions"
                value={row.quantity}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'quantity', e.target.value)}
              />
              <input
                aria-label={`${label} price ($)`}
                type="number"
                min={0}
                step={0.01}
                className={adminStyles.input}
                placeholder="Price ($)"
                value={row.price}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'price', e.target.value)}
              />
              <button
                type="button"
                className={adminStyles.btnSecondary}
                aria-label={`Remove ${label.toLowerCase()}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((candidate) => candidate.key !== row.key))}
              >
                Remove
              </button>
            </div>
            <div className={status.tone === 'error' ? adminStyles.errorText : adminStyles.formHint}>{status.text}</div>
          </div>
        );
      })}

      <button
        type="button"
        className={adminStyles.btnSecondary}
        disabled={disabled}
        onClick={() => onChange([...rows, emptyPackRow(defaultMinutes)])}
      >
        Add pack
      </button>
    </div>
  );
}
