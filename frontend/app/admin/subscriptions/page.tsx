'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import {
  cancelSubscriptionAdmin,
  changeSubscriptionSchedule,
  fetchSubscriptions,
  reactivateSubscription,
  type AdminSubscriptionStatusFilter,
} from '../../../lib/services/subscriptionsAdmin';
import type { AdminSubscriptionRow, GroupClass, GroupClassSchedule } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type StatusTab = 'all' | AdminSubscriptionStatusFilter;

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending_cancel', label: 'Pending cancel' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function scheduleLine(schedule: Pick<GroupClassSchedule, 'dayOfWeek' | 'startTime' | 'endTime'>): string {
  return `${DAY_LABELS[schedule.dayOfWeek]} · ${schedule.startTime}-${schedule.endTime}`;
}

function coachLine(schedule: AdminSubscriptionRow['scheduleId']): string {
  return `${schedule.coachId.firstName} ${schedule.coachId.lastName}`;
}

interface ChangeScheduleDialogState {
  open: boolean;
  step: 'pick' | 'confirm';
  subscription: AdminSubscriptionRow | null;
  newScheduleId: string;
  saving: boolean;
  error: string | null;
}

const EMPTY_CHANGE_DIALOG: ChangeScheduleDialogState = {
  open: false,
  step: 'pick',
  subscription: null,
  newScheduleId: '',
  saving: false,
  error: null,
};

interface CancelDialogState {
  open: boolean;
  subscription: AdminSubscriptionRow | null;
  saving: boolean;
  error: string | null;
}

interface ReactivateDialogState {
  open: boolean;
  subscription: AdminSubscriptionRow | null;
  saving: boolean;
  error: string | null;
}

async function fetchScheduleOptionsData() {
  const [schedules, groupClasses] = await Promise.all([fetchSchedules(), fetchGroupClasses()]);
  return { schedules, groupClasses };
}

export default function AdminSubscriptionsPage() {
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);

  // Client debounce (400ms) on the search box before it becomes a request
  // param — avoids firing a request on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchInput.trim()), 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Any filter change resets to page 1 — a stale page number for a new
  // filter would otherwise show an empty "page 3 of 1" state.
  useEffect(() => {
    setPage(1);
  }, [statusTab, debouncedQuery]);

  async function fetchPageData() {
    return fetchSubscriptions({
      status: statusTab === 'all' ? undefined : statusTab,
      q: debouncedQuery || undefined,
      page,
    });
  }

  const { data, error, isLoading, retry } = useLoadState(fetchPageData, [statusTab, debouncedQuery, page]);
  const [rows, setRows] = useState<AdminSubscriptionRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (data) {
      setRows(data.subscriptions);
      setTotalPages(data.totalPages);
    }
  }, [data]);

  // Loaded once — feeds the Change Schedule dialog's "same level, not
  // current" schedule picker. Independent of the main list's filters.
  const { data: scheduleOptionsData } = useLoadState(fetchScheduleOptionsData, []);
  const [allSchedules, setAllSchedules] = useState<GroupClassSchedule[]>([]);
  const [allGroupClasses, setAllGroupClasses] = useState<GroupClass[]>([]);

  useEffect(() => {
    if (scheduleOptionsData) {
      setAllSchedules(scheduleOptionsData.schedules);
      setAllGroupClasses(scheduleOptionsData.groupClasses);
    }
  }, [scheduleOptionsData]);

  const [changeDialog, setChangeDialog] = useState<ChangeScheduleDialogState>(EMPTY_CHANGE_DIALOG);
  const [cancelDialog, setCancelDialog] = useState<CancelDialogState>({
    open: false,
    subscription: null,
    saving: false,
    error: null,
  });
  const [reactivateDialog, setReactivateDialog] = useState<ReactivateDialogState>({
    open: false,
    subscription: null,
    saving: false,
    error: null,
  });

  function openChangeSchedule(subscription: AdminSubscriptionRow) {
    setChangeDialog({
      open: true,
      step: 'pick',
      subscription,
      newScheduleId: '',
      saving: false,
      error: null,
    });
  }

  function closeChangeSchedule() {
    if (changeDialog.saving) return;
    setChangeDialog(EMPTY_CHANGE_DIALOG);
  }

  const currentLevelId = changeDialog.subscription?.scheduleId.classId.levelId._id ?? null;

  const candidateSchedules = useMemo(() => {
    if (!changeDialog.subscription) return [];

    return allSchedules.filter((schedule) => {
      if (schedule._id === changeDialog.subscription!.scheduleId._id) return false;
      const groupClass = allGroupClasses.find((gc) => gc._id === schedule.classId);
      return groupClass ? groupClass.levelId === currentLevelId : false;
    });
  }, [allSchedules, allGroupClasses, changeDialog.subscription, currentLevelId]);

  function candidateLabel(schedule: GroupClassSchedule): string {
    const groupClass = allGroupClasses.find((gc) => gc._id === schedule.classId);
    return `${groupClass ? groupClass.name : 'Class'} — ${DAY_LABELS[schedule.dayOfWeek]} ${schedule.startTime}-${schedule.endTime}`;
  }

  const selectedNewSchedule = allSchedules.find((s) => s._id === changeDialog.newScheduleId) ?? null;
  const selectedNewGroupClass = selectedNewSchedule
    ? allGroupClasses.find((gc) => gc._id === selectedNewSchedule.classId) ?? null
    : null;

  async function submitChangeSchedule() {
    if (!changeDialog.subscription || !changeDialog.newScheduleId) return;

    setChangeDialog((prev) => ({ ...prev, saving: true, error: null }));

    const result = await changeSubscriptionSchedule(
      changeDialog.subscription._id,
      changeDialog.newScheduleId
    );

    if (result.status === 'success') {
      setChangeDialog(EMPTY_CHANGE_DIALOG);
      retry();
    } else {
      setChangeDialog((prev) => ({ ...prev, saving: false, error: result.message }));
    }
  }

  function openCancel(subscription: AdminSubscriptionRow) {
    setCancelDialog({ open: true, subscription, saving: false, error: null });
  }

  async function submitCancel() {
    if (!cancelDialog.subscription) return;

    setCancelDialog((prev) => ({ ...prev, saving: true, error: null }));

    const result = await cancelSubscriptionAdmin(cancelDialog.subscription._id);

    if (result.status === 'success') {
      setCancelDialog({ open: false, subscription: null, saving: false, error: null });
      retry();
    } else {
      setCancelDialog((prev) => ({ ...prev, saving: false, error: result.message }));
    }
  }

  function openReactivate(subscription: AdminSubscriptionRow) {
    setReactivateDialog({ open: true, subscription, saving: false, error: null });
  }

  async function submitReactivate() {
    if (!reactivateDialog.subscription) return;

    setReactivateDialog((prev) => ({ ...prev, saving: true, error: null }));

    const result = await reactivateSubscription(reactivateDialog.subscription._id);

    if (result.status === 'success') {
      setReactivateDialog({ open: false, subscription: null, saving: false, error: null });
      retry();
    } else {
      setReactivateDialog((prev) => ({ ...prev, saving: false, error: result.message }));
    }
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Subscriptions" count={isLoading ? undefined : rows.length} />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <input
          type="search"
          className={styles.input}
          style={{ maxWidth: 280 }}
          placeholder="Search student or parent…"
          aria-label="Search subscriptions"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className={styles.select}
          style={{ maxWidth: 200 }}
          aria-label="Status"
          value={statusTab}
          onChange={(e) => setStatusTab(e.target.value as StatusTab)}
        >
          {STATUS_TABS.map((tab) => (
            <option key={tab.value} value={tab.value}>
              {tab.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Student</th>
                <th className={styles.th}>Parent</th>
                <th className={styles.th}>Class</th>
                <th className={styles.th}>Schedule</th>
                <th className={styles.th}>Next billing</th>
                <th className={styles.th}>Last charge</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th} style={{ width: 240 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={8} />
              ) : rows.length === 0 ? (
                <AdminEmptyRow colSpan={8} message="No subscriptions found" />
              ) : (
                rows.map((row) => {
                  const isPendingCancel = row.status === 'active' && row.cancelAtPeriodEnd;
                  const isActive = row.status === 'active' && !row.cancelAtPeriodEnd;
                  const isCancelled = row.status === 'cancelled';

                  return (
                    <tr key={row._id} className={styles.trHover}>
                      <td className={styles.td}>
                        {row.studentId.firstName} {row.studentId.lastName}
                      </td>
                      <td className={styles.td}>
                        {row.parentId.firstName} {row.parentId.lastName}
                        <div className={styles.cellMuted}>{row.parentId.email}</div>
                      </td>
                      <td className={styles.td}>
                        {row.scheduleId.classId.name}
                        <div className={styles.cellMuted}>{row.scheduleId.classId.levelId.name}</div>
                      </td>
                      <td className={styles.td}>
                        {scheduleLine(row.scheduleId)}
                        <div className={styles.cellMuted}>{coachLine(row.scheduleId)}</div>
                      </td>
                      <td className={styles.td}>{formatDateLabel(row.nextBillingDate)}</td>
                      <td className={styles.td}>
                        {row.lastChargeAmount != null ? `$${row.lastChargeAmount.toFixed(2)}` : '—'}
                        {row.lastSiblingDiscountApplied ? (
                          <span className={styles.chipMuted} style={{ marginLeft: 6 }}>
                            10% sibling
                          </span>
                        ) : null}
                      </td>
                      <td className={styles.td}>
                        {isCancelled ? (
                          <span className={styles.chipMuted}>Cancelled</span>
                        ) : isPendingCancel ? (
                          <span className={styles.chip} style={{ background: 'var(--color-bg)', color: 'var(--color-gold)' }}>
                            Cancels {formatDateLabel(row.currentPeriodEnd)}
                          </span>
                        ) : (
                          <span className={`${styles.chip} ${styles.chipActive}`}>Active</span>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <div className={styles.actionBtns}>
                          {(isActive || isPendingCancel) && (
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              onClick={() => openChangeSchedule(row)}
                            >
                              Change Schedule
                            </button>
                          )}
                          {isActive ? (
                            <button type="button" className={styles.btnDanger} onClick={() => openCancel(row)}>
                              Cancel
                            </button>
                          ) : null}
                          {isPendingCancel ? (
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              onClick={() => openReactivate(row)}
                            >
                              Reactivate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <span className={styles.cellMuted}>
              Page {data?.currentPage ?? 1} of {totalPages}
            </span>
            <div className={styles.actionBtns}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {changeDialog.open && changeDialog.subscription ? (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && closeChangeSchedule()}>
          <div className={styles.dialog} role="dialog" aria-label="Change Schedule">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Change Schedule</h2>
              <button type="button" className={styles.dialogClose} onClick={closeChangeSchedule} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {changeDialog.error ? <Alert variant="error">{changeDialog.error}</Alert> : null}

              {changeDialog.step === 'pick' ? (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Current schedule</label>
                    <div className={styles.cellMuted}>
                      {changeDialog.subscription.scheduleId.classId.name} —{' '}
                      {scheduleLine(changeDialog.subscription.scheduleId)} (
                      {coachLine(changeDialog.subscription.scheduleId)})
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="new-schedule">
                      New schedule
                    </label>
                    {candidateSchedules.length === 0 ? (
                      <div className={styles.formHint}>
                        No other schedules are available at this student&apos;s level yet.
                      </div>
                    ) : (
                      <select
                        id="new-schedule"
                        className={styles.select}
                        value={changeDialog.newScheduleId}
                        onChange={(e) =>
                          setChangeDialog((prev) => ({ ...prev, newScheduleId: e.target.value }))
                        }
                      >
                        <option value="">Select a schedule</option>
                        {candidateSchedules.map((schedule) => (
                          <option key={schedule._id} value={schedule._id}>
                            {candidateLabel(schedule)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Before</label>
                    <div className={styles.cellMuted}>
                      {changeDialog.subscription.scheduleId.classId.name} —{' '}
                      {scheduleLine(changeDialog.subscription.scheduleId)} (
                      {coachLine(changeDialog.subscription.scheduleId)})
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>After</label>
                    <div className={styles.cellMuted}>
                      {selectedNewGroupClass?.name} — {selectedNewSchedule ? scheduleLine(selectedNewSchedule) : ''}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                    Monthly fee unchanged — same level.
                  </p>
                </>
              )}
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.btnSecondary} onClick={closeChangeSchedule} disabled={changeDialog.saving}>
                Cancel
              </button>
              {changeDialog.step === 'pick' ? (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={!changeDialog.newScheduleId}
                  onClick={() => setChangeDialog((prev) => ({ ...prev, step: 'confirm', error: null }))}
                >
                  Continue
                </button>
              ) : (
                <button type="button" className={styles.btnPrimary} onClick={submitChangeSchedule} disabled={changeDialog.saving}>
                  {changeDialog.saving ? 'Saving…' : 'Confirm Change'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {cancelDialog.open && cancelDialog.subscription ? (
        <div
          className={styles.overlay}
          onClick={(e) =>
            e.target === e.currentTarget &&
            !cancelDialog.saving &&
            setCancelDialog({ open: false, subscription: null, saving: false, error: null })
          }
        >
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog" aria-label="Cancel Subscription">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Cancel Subscription</h2>
            </div>
            <div className={styles.dialogBody}>
              {cancelDialog.error ? <Alert variant="error">{cancelDialog.error}</Alert> : null}
              <p style={{ margin: 0 }}>
                Cancel {cancelDialog.subscription.studentId.firstName}&apos;s subscription? Classes
                continue through {formatDateLabel(cancelDialog.subscription.currentPeriodEnd)}; nothing
                is refunded and the subscription will not renew.
              </p>
            </div>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={cancelDialog.saving}
                onClick={() => setCancelDialog({ open: false, subscription: null, saving: false, error: null })}
              >
                Keep Subscription
              </button>
              <button type="button" className={styles.btnDangerFilled} onClick={submitCancel} disabled={cancelDialog.saving}>
                {cancelDialog.saving ? 'Cancelling…' : 'Cancel Subscription'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reactivateDialog.open && reactivateDialog.subscription ? (
        <div
          className={styles.overlay}
          onClick={(e) =>
            e.target === e.currentTarget &&
            !reactivateDialog.saving &&
            setReactivateDialog({ open: false, subscription: null, saving: false, error: null })
          }
        >
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog" aria-label="Reactivate Subscription">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Reactivate Subscription</h2>
            </div>
            <div className={styles.dialogBody}>
              {reactivateDialog.error ? <Alert variant="error">{reactivateDialog.error}</Alert> : null}
              <p style={{ margin: 0 }}>
                Remove the pending cancellation? Renewals continue as normal; nothing is charged now.
              </p>
            </div>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={reactivateDialog.saving}
                onClick={() => setReactivateDialog({ open: false, subscription: null, saving: false, error: null })}
              >
                Close
              </button>
              <button type="button" className={styles.btnPrimary} onClick={submitReactivate} disabled={reactivateDialog.saving}>
                {reactivateDialog.saving ? 'Reactivating…' : 'Remove Cancellation'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
