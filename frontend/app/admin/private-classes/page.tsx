'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchUsers } from '../../../lib/services/users';
import {
  cancelPrivateClassEnrollmentAdmin,
  createPrivateClassScheduleAdmin,
  deletePrivateClassSchedule,
  fetchPrivateClassEnrollmentsAdmin,
  fetchPrivateClassSchedulesAdmin,
} from '../../../lib/services/privateClassAdmin';
import { formatTime } from '../../../lib/formatTime';
import type { AuthUser, PrivateClassEnrollmentRow, PrivateClassScheduleRow } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Tab = 'enrollments' | 'schedules';

function isKnownTab(value: string | null): value is Tab {
  return value === 'enrollments' || value === 'schedules';
}

async function fetchPageData() {
  const [enrollments, schedules, coaches] = await Promise.all([
    fetchPrivateClassEnrollmentsAdmin(),
    fetchPrivateClassSchedulesAdmin(),
    fetchUsers('coach'),
  ]);
  return { enrollments, schedules, coaches };
}

interface SlotForm {
  coachId: string;
  dayOfWeek: string;
  startTime: string;
  durationMinutes: string;
}

const EMPTY_SLOT_FORM: SlotForm = { coachId: '', dayOfWeek: '1', startTime: '', durationMinutes: '60' };

export default function AdminPrivateClassesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(isKnownTab(paramTab) ? paramTab : 'enrollments');

  const { data, error, isLoading, retry } = useLoadState(fetchPageData, []);
  const [enrollments, setEnrollments] = useState<PrivateClassEnrollmentRow[]>([]);
  const [schedules, setSchedules] = useState<PrivateClassScheduleRow[]>([]);
  const [coaches, setCoaches] = useState<AuthUser[]>([]);

  useEffect(() => {
    if (data) {
      setEnrollments(data.enrollments);
      setSchedules(data.schedules);
      setCoaches(data.coaches);
    }
  }, [data]);

  function selectTab(next: Tab) {
    setTab(next);
    router.replace(`/admin/private-classes?tab=${next}`);
  }

  const scheduleByEnrollmentId = useMemo(() => {
    const map = new Map<string, PrivateClassScheduleRow>();
    schedules.forEach((schedule) => {
      if (schedule.enrollmentId) {
        map.set(schedule.enrollmentId, schedule);
      }
    });
    return map;
  }, [schedules]);

  // ── Cancel enrollment ────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<PrivateClassEnrollmentRow | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);

    const result = await cancelPrivateClassEnrollmentAdmin(cancelTarget._id);

    setCancelling(false);

    if (result.status === 'success') {
      setCancelTarget(null);
      retry();
    } else {
      setCancelError(result.message);
    }
  }

  // ── Add slot ─────────────────────────────────────────────────────────────
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [slotForm, setSlotForm] = useState<SlotForm>(EMPTY_SLOT_FORM);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotSaving, setSlotSaving] = useState(false);

  function setSlotField(key: keyof SlotForm, value: string) {
    setSlotForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAddSlot() {
    setSlotError(null);

    if (!slotForm.coachId || !slotForm.startTime) {
      setSlotError('Coach and start time are required.');
      return;
    }

    setSlotSaving(true);

    const result = await createPrivateClassScheduleAdmin({
      coachId: slotForm.coachId,
      dayOfWeek: Number(slotForm.dayOfWeek),
      startTime: slotForm.startTime,
      durationMinutes: Number(slotForm.durationMinutes) || undefined,
    });

    setSlotSaving(false);

    if (result.status === 'success') {
      setAddSlotOpen(false);
      setSlotForm(EMPTY_SLOT_FORM);
      retry();
    } else {
      setSlotError(result.message);
    }
  }

  // ── Delete slot ──────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<PrivateClassScheduleRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const result = await deletePrivateClassSchedule(deleteTarget._id);

    setDeleting(false);

    if (result.status === 'success') {
      setDeleteTarget(null);
      retry();
    } else {
      setDeleteError(result.message);
    }
  }

  function coachLabel(coachId: PrivateClassScheduleRow['coachId']): string {
    if (typeof coachId === 'string') {
      const coach = coaches.find((c) => c._id === coachId);
      return coach ? `${coach.firstName} ${coach.lastName}` : coachId;
    }
    return `${coachId.firstName} ${coachId.lastName}`;
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Private Classes" />
        {tab === 'schedules' ? (
          <button type="button" className={styles.btnPrimary} onClick={() => setAddSlotOpen(true)}>
            <Plus size={14} /> Add Slot
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button
          type="button"
          className={tab === 'enrollments' ? `${styles.chip} ${styles.chipActive}` : styles.chip}
          style={{ border: 'none', cursor: 'pointer' }}
          onClick={() => selectTab('enrollments')}
        >
          Enrollments
        </button>
        <button
          type="button"
          className={tab === 'schedules' ? `${styles.chip} ${styles.chipActive}` : styles.chip}
          style={{ border: 'none', cursor: 'pointer' }}
          onClick={() => selectTab('schedules')}
        >
          Schedules
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : tab === 'enrollments' ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Student</th>
                <th className={styles.th}>Parent</th>
                <th className={styles.th}>Coach</th>
                <th className={styles.th}>Slot</th>
                <th className={styles.th}>Rate</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th} style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={7} />
              ) : enrollments.length === 0 ? (
                <AdminEmptyRow colSpan={7} message="No private class enrollments found" />
              ) : (
                enrollments.map((enrollment) => {
                  const slot = scheduleByEnrollmentId.get(enrollment._id);
                  return (
                    <tr key={enrollment._id} className={styles.trHover}>
                      <td className={styles.td}>
                        {enrollment.studentId.firstName} {enrollment.studentId.lastName}
                      </td>
                      <td className={styles.td}>
                        {enrollment.parentId.firstName} {enrollment.parentId.lastName}
                        <div className={styles.cellMuted}>{enrollment.parentId.email}</div>
                      </td>
                      <td className={styles.td}>
                        {enrollment.coachId.firstName} {enrollment.coachId.lastName}
                      </td>
                      <td className={styles.td}>
                        {slot ? `${DAY_LABELS[slot.dayOfWeek]} ${formatTime(slot.startTime)}` : '—'}
                      </td>
                      <td className={styles.td}>${enrollment.agreedHourlyRate.toFixed(2)}/hr</td>
                      <td className={styles.td}>
                        {enrollment.status === 'active' ? (
                          <span className={`${styles.chip} ${styles.chipActive}`}>Active</span>
                        ) : (
                          <span className={styles.chipMuted}>Cancelled</span>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        {enrollment.status === 'active' ? (
                          <button
                            type="button"
                            className={styles.btnDanger}
                            onClick={() => {
                              setCancelError(null);
                              setCancelTarget(enrollment);
                            }}
                          >
                            Cancel
                          </button>
                        ) : (
                          <span className={styles.cellMuted}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Coach</th>
                <th className={styles.th}>Day</th>
                <th className={styles.th}>Start</th>
                <th className={styles.th}>Duration</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th} style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={6} />
              ) : schedules.length === 0 ? (
                <AdminEmptyRow colSpan={6} message="No private class slots found" />
              ) : (
                schedules.map((schedule) => (
                  <tr key={schedule._id} className={styles.trHover}>
                    <td className={styles.td}>{coachLabel(schedule.coachId)}</td>
                    <td className={styles.td}>{DAY_LABELS[schedule.dayOfWeek]}</td>
                    <td className={styles.td}>{formatTime(schedule.startTime)}</td>
                    <td className={styles.td}>{schedule.durationMinutes} min</td>
                    <td className={styles.td}>
                      {schedule.studentId ? (
                        <span className={styles.chipMuted}>
                          {typeof schedule.studentId === 'string'
                            ? 'Occupied'
                            : `${schedule.studentId.firstName} ${schedule.studentId.lastName}`}
                        </span>
                      ) : (
                        <span className={`${styles.chip} ${styles.chipActive}`}>Available</span>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <button
                        type="button"
                        className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                        title="Delete"
                        aria-label={`Delete slot ${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(schedule.startTime)}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(schedule);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {addSlotOpen ? (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && !slotSaving && setAddSlotOpen(false)}>
          <div className={styles.dialog} role="dialog" aria-label="Add Slot">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Add Slot</h2>
              <button
                type="button"
                className={styles.dialogClose}
                onClick={() => !slotSaving && setAddSlotOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {slotError ? <Alert variant="error">{slotError}</Alert> : null}

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="slot-coachId">
                  Coach
                </label>
                <select
                  id="slot-coachId"
                  className={styles.select}
                  value={slotForm.coachId}
                  onChange={(e) => setSlotField('coachId', e.target.value)}
                >
                  <option value="">Select a coach</option>
                  {coaches.map((coach) => (
                    <option key={coach._id} value={coach._id}>
                      {coach.firstName} {coach.lastName}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="slot-dayOfWeek">
                  Day of Week
                </label>
                <select
                  id="slot-dayOfWeek"
                  className={styles.select}
                  value={slotForm.dayOfWeek}
                  onChange={(e) => setSlotField('dayOfWeek', e.target.value)}
                >
                  {DAY_LABELS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="slot-startTime">
                  Start Time
                </label>
                <input
                  id="slot-startTime"
                  type="time"
                  className={styles.input}
                  value={slotForm.startTime}
                  onChange={(e) => setSlotField('startTime', e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="slot-durationMinutes">
                  Duration (min)
                </label>
                <input
                  id="slot-durationMinutes"
                  type="number"
                  min={15}
                  className={styles.input}
                  value={slotForm.durationMinutes}
                  onChange={(e) => setSlotField('durationMinutes', e.target.value)}
                />
              </div>
            </div>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setAddSlotOpen(false)}
                disabled={slotSaving}
              >
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handleAddSlot} disabled={slotSaving}>
                {slotSaving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelTarget ? (
        <div
          className={styles.overlay}
          onClick={(e) => e.target === e.currentTarget && !cancelling && setCancelTarget(null)}
        >
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Cancel Enrollment</h2>
            </div>
            <div className={styles.dialogBody}>
              {cancelError ? <Alert variant="error">{cancelError}</Alert> : null}
              <p style={{ margin: 0 }}>
                Cancel {cancelTarget.studentId.firstName}&apos;s private lessons? All upcoming sessions
                will be removed and the weekly slot released. Completed sessions already charged are
                unaffected.
              </p>
            </div>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
              >
                Keep Enrollment
              </button>
              <button type="button" className={styles.btnDangerFilled} onClick={handleCancelConfirm} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel Enrollment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className={styles.overlay}
          onClick={(e) => e.target === e.currentTarget && !deleting && setDeleteTarget(null)}
        >
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>{deleteError ? 'Cannot Delete' : 'Delete Slot'}</h2>
            </div>
            <div className={styles.dialogBody}>
              <p style={{ margin: 0 }}>
                {deleteError ??
                  `Delete the ${DAY_LABELS[deleteTarget.dayOfWeek]} ${formatTime(deleteTarget.startTime)} slot? This cannot be undone.`}
              </p>
            </div>
            <div className={styles.dialogFooter}>
              {deleteError ? (
                <button type="button" className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.btnDangerFilled}
                    onClick={handleDeleteConfirm}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
