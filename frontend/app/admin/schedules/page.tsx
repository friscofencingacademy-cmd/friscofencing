'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { createSchedule, fetchCoaches, fetchSchedules } from '../../../lib/services/scheduling';
import { fetchGroupClasses } from '../../../lib/services/catalog';
import type { Coach, GroupClass, GroupClassSchedule } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ScheduleForm {
  classId: string;
  coachId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

const EMPTY_FORM: ScheduleForm = { classId: '', coachId: '', dayOfWeek: '1', startTime: '', endTime: '' };

async function fetchSchedulesPageData() {
  const [schedules, groupClasses, coaches] = await Promise.all([
    fetchSchedules(),
    fetchGroupClasses(),
    fetchCoaches(),
  ]);
  return { schedules, groupClasses, coaches };
}

function classNameFor(groupClasses: GroupClass[], id: string): string {
  return groupClasses.find((groupClass) => groupClass._id === id)?.name ?? id;
}

function coachNameFor(coaches: Coach[], id: string): string {
  const coach = coaches.find((c) => c._id === id);
  return coach ? `${coach.firstName} ${coach.lastName}` : id;
}

export default function SchedulesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchSchedulesPageData, []);
  const [items, setItems] = useState<GroupClassSchedule[]>([]);
  const [groupClasses, setGroupClasses] = useState<GroupClass[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data.schedules);
      setGroupClasses(data.groupClasses);
      setCoaches(data.coaches);
    }
  }, [data]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setDialogError(null);
  }

  function setField(key: keyof ScheduleForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setDialogError(null);

    if (!form.classId || !form.coachId || !form.startTime || !form.endTime) {
      setDialogError('Class, coach, start time, and end time are required.');
      return;
    }

    setSaving(true);

    const result = await createSchedule({
      classId: form.classId,
      coachId: form.coachId,
      dayOfWeek: Number(form.dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
    });

    setSaving(false);

    if (result.status === 'success') {
      setDialogOpen(false);
      retry();
    } else {
      setDialogError(result.message);
    }
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Schedules" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Schedule
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Class</th>
                <th className={styles.th}>Coach</th>
                <th className={styles.th}>Day</th>
                <th className={styles.th}>Start</th>
                <th className={styles.th}>End</th>
                <th className={styles.th}>Roster</th>
                <th className={styles.th} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={7} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={7} message="No schedules found" />
              ) : (
                items.map((schedule) => (
                  <tr key={schedule._id} className={styles.trHover}>
                    <td className={styles.td}>{classNameFor(groupClasses, schedule.classId)}</td>
                    <td className={styles.td}>{coachNameFor(coaches, schedule.coachId)}</td>
                    <td className={styles.td}>{DAY_LABELS[schedule.dayOfWeek]}</td>
                    <td className={styles.td}>{schedule.startTime}</td>
                    <td className={styles.td}>{schedule.endTime}</td>
                    <td className={styles.td}>{schedule.students.length}</td>
                    <td className={styles.td}>
                      <Link href={`/admin/schedules/${schedule._id}/sessions`}>View Sessions</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className={styles.tableFooterNote}>
            Schedules can&apos;t be edited once created — create a new one instead.
          </div>
        </div>
      )}

      {dialogOpen ? (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && closeDialog()}>
          <div className={styles.dialog} role="dialog" aria-label="Add Schedule">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Add Schedule</h2>
              <button type="button" className={styles.dialogClose} onClick={closeDialog} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="schedule-classId">
                  Class
                </label>
                <select
                  id="schedule-classId"
                  className={styles.select}
                  value={form.classId}
                  onChange={(e) => setField('classId', e.target.value)}
                  required
                >
                  <option value="">Select a class</option>
                  {groupClasses.map((groupClass) => (
                    <option key={groupClass._id} value={groupClass._id}>
                      {groupClass.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="schedule-coachId">
                  Coach
                </label>
                <select
                  id="schedule-coachId"
                  className={styles.select}
                  value={form.coachId}
                  onChange={(e) => setField('coachId', e.target.value)}
                  required
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
                <label className={styles.label} htmlFor="schedule-dayOfWeek">
                  Day of Week
                </label>
                <select
                  id="schedule-dayOfWeek"
                  className={styles.select}
                  value={form.dayOfWeek}
                  onChange={(e) => setField('dayOfWeek', e.target.value)}
                >
                  {DAY_LABELS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="schedule-startTime">
                  Start Time
                </label>
                <input
                  id="schedule-startTime"
                  type="time"
                  className={styles.input}
                  value={form.startTime}
                  onChange={(e) => setField('startTime', e.target.value)}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="schedule-endTime">
                  End Time
                </label>
                <input
                  id="schedule-endTime"
                  type="time"
                  className={styles.input}
                  value={form.endTime}
                  onChange={(e) => setField('endTime', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
