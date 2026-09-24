'use client';

import { useState } from 'react';

import { publishPrivateAvailability } from '../../../../lib/services/privateClass';
import { DAY_LABELS } from '../../../../lib/constants';
import type { AuthUser } from '../../../../lib/types';
import Alert from '../../ui/Alert/Alert';
import Button from '../../ui/Button/Button';
import Modal from '../../ui/Modal/Modal';
import styles from './PublishAvailabilityDialog.module.css';

export interface PublishAvailabilityDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with how many slots were published. */
  onPublished: (count: number) => void;
  /** Admin only: the coaches to publish for (renders a coach picker). A
   * coach omits it and always publishes for themselves. */
  coaches?: AuthUser[];
}

interface FormState {
  coachId: string;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  windowStart: string;
  windowEnd: string;
  slotDurationMinutes: string;
}

const EMPTY_FORM: FormState = {
  coachId: '',
  startDate: '',
  endDate: '',
  daysOfWeek: [],
  windowStart: '',
  windowEnd: '',
  slotDurationMinutes: '',
};

// Bulk-publishes private-lesson availability (docs/decisions/011-private-per-
// session-booking.md): weekdays x a time window cut into slots, bookable over
// a date range. Every rule (slot math, overlap, range limits, the default
// slot length) is the backend's; this form only collects input and shows the
// backend's message verbatim when it refuses.
export default function PublishAvailabilityDialog({ open, onClose, onPublished, coaches }: PublishAvailabilityDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((existing) => existing !== day)
        : [...prev.daysOfWeek, day],
    }));
  }

  function close() {
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  async function handlePublish() {
    if ((coaches && !form.coachId) || !form.startDate || !form.endDate || !form.windowStart || !form.windowEnd) {
      setError('Fill in every field (slot length is optional).');
      return;
    }

    if (form.daysOfWeek.length === 0) {
      setError('Pick at least one day of the week.');
      return;
    }

    setError(null);
    setSaving(true);

    const result = await publishPrivateAvailability({
      ...(coaches ? { coachId: form.coachId } : {}),
      daysOfWeek: form.daysOfWeek,
      windowStart: form.windowStart,
      windowEnd: form.windowEnd,
      ...(form.slotDurationMinutes ? { slotDurationMinutes: Number(form.slotDurationMinutes) } : {}),
      startDate: form.startDate,
      endDate: form.endDate,
    });

    setSaving(false);

    if (result.status === 'success') {
      setForm(EMPTY_FORM);
      onPublished(result.data.length);
    } else {
      setError(result.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Publish Availability"
      disableClose={saving}
      footer={
        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handlePublish} loading={saving}>
            Publish
          </Button>
        </div>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}

      {coaches ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="availability-coach">
            Coach
          </label>
          <select
            id="availability-coach"
            className={styles.select}
            value={form.coachId}
            onChange={(event) => setField('coachId', event.target.value)}
          >
            <option value="">Select a coach</option>
            {coaches.map((coach) => (
              <option key={coach._id} value={coach._id}>
                {coach.firstName} {coach.lastName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="availability-start-date">
            From
          </label>
          <input
            id="availability-start-date"
            type="date"
            className={styles.input}
            value={form.startDate}
            onChange={(event) => setField('startDate', event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="availability-end-date">
            Until
          </label>
          <input
            id="availability-end-date"
            type="date"
            className={styles.input}
            value={form.endDate}
            onChange={(event) => setField('endDate', event.target.value)}
          />
        </div>
      </div>

      <div className={styles.field}>
        <fieldset className={styles.days}>
          <legend className={styles.label}>Days</legend>
          {DAY_LABELS.map((label, day) => (
            <label key={label} className={styles.day}>
              <input
                type="checkbox"
                checked={form.daysOfWeek.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {label.slice(0, 3)}
            </label>
          ))}
        </fieldset>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="availability-window-start">
            Start time
          </label>
          <input
            id="availability-window-start"
            type="time"
            className={styles.input}
            value={form.windowStart}
            onChange={(event) => setField('windowStart', event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="availability-window-end">
            End time
          </label>
          <input
            id="availability-window-end"
            type="time"
            className={styles.input}
            value={form.windowEnd}
            onChange={(event) => setField('windowEnd', event.target.value)}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="availability-slot-length">
          Slot length (minutes)
        </label>
        <input
          id="availability-slot-length"
          type="number"
          min={15}
          step={5}
          className={styles.input}
          placeholder="Contract default"
          value={form.slotDurationMinutes}
          onChange={(event) => setField('slotDurationMinutes', event.target.value)}
        />
        <p className={styles.hint}>
          The time window is cut into back-to-back slots of this length. A slot that would run past the end time
          is left out.
        </p>
      </div>
    </Modal>
  );
}
