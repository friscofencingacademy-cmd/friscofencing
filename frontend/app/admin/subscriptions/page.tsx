'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import {
  cancelSubscriptionAdmin,
  changeSubscriptionSchedule,
  chargeSubscription,
  fetchChargePreview,
  fetchPaymentHistoryForParent,
  fetchSubscriptions,
  reactivateSubscription,
  recordManualPayment,
  type AdminSubscriptionStatusFilter,
} from '../../../lib/services/subscriptionsAdmin';
import { formatTime } from '../../../lib/formatTime';
import { formatDateOnly, formatInstant } from '../../../lib/formatDate';
import type {
  AdminSubscriptionRow,
  ChargeOption,
  ChargePreview,
  ChargeResult,
  GroupClass,
  GroupClassSchedule,
  PaymentHistoryRow,
} from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import PaymentHistoryTable from '../../components/ui/PaymentHistoryTable/PaymentHistoryTable';
import styles from '../../components/admin/admin.module.css';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type StatusTab = 'all' | AdminSubscriptionStatusFilter;

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending_cancel', label: 'Pending cancel' },
  { value: 'cancelled', label: 'Cancelled' },
];

// nextBillingDate/currentPeriodEnd/periodStart/periodEnd are calendar-day
// sentinels — formatDateOnly renders them UTC-anchored, never browser-local
// (docs/plans/utc-date-standard-plan.md). nextRetryAt is a real instant
// (Central-midnight, via billingDates.js's addOneDay) and is rendered
// separately via formatInstant — see describeChargeOutcome below.
function formatDateLabel(iso: string): string {
  return formatDateOnly(iso);
}

function scheduleLine(schedule: Pick<GroupClassSchedule, 'dayOfWeek' | 'startTime' | 'endTime'>): string {
  return `${DAY_LABELS[schedule.dayOfWeek]} · ${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)}`;
}

// coachId is null when the coach was deleted without a delete-guard
// blocking it (orphaned-coach-reference-fix-plan D2) — never assume it's
// populated.
function coachLine(schedule: AdminSubscriptionRow['scheduleId']): string {
  return schedule.coachId
    ? `${schedule.coachId.firstName} ${schedule.coachId.lastName}`
    : 'Coach no longer available';
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatCardLabel(paymentMethod: NonNullable<ChargePreview['paymentMethod']>): string {
  const brand = paymentMethod.cardBrand.charAt(0).toUpperCase() + paymentMethod.cardBrand.slice(1);
  return `${brand} •••• ${paymentMethod.cardLast4}`;
}

// Every outcome renewOne/retryOne can return, turned into plain-language
// copy for the dialog — the button never invents its own vocabulary, it
// only describes whichever outcome actually came back
// (docs/plans/manual-charge-and-pdf-invoice-plan.md D2).
function describeChargeOutcome(result: ChargeResult): { variant: 'success' | 'error'; message: string } {
  switch (result.outcome) {
    case 'charged':
      return {
        variant: 'success',
        message: `Charged ${formatMoney(result.chargeAmount ?? 0)}${
          result.siblingDiscountApplied ? ' (10% sibling discount applied).' : '.'
        }`,
      };
    case 'cancelled_finalized':
      return { variant: 'success', message: 'Cancellation finalized — nothing was charged.' };
    case 'skipped_already_charged':
      return {
        variant: 'success',
        message: 'This period was already charged — the subscription is up to date.',
      };
    case 'failed_payment':
      return {
        variant: 'error',
        message: `Card declined: ${result.failureMessage || 'payment failed'}.${
          result.nextRetryAt ? ` A retry is scheduled for ${formatInstant(result.nextRetryAt)}.` : ''
        }`,
      };
    case 'cancelled_exhausted':
      return {
        variant: 'error',
        message: 'Retries were already exhausted — the subscription has been cancelled.',
      };
    case 'failed_no_payment_method':
      return { variant: 'error', message: 'No card on file — nothing was charged.' };
    case 'failed_no_price':
      return { variant: 'error', message: 'Could not resolve a price for this class — nothing was charged.' };
    case 'skipped_not_due':
      return { variant: 'error', message: 'Not due yet — nothing was charged.' };
    case 'skipped_inactive':
      return { variant: 'error', message: 'This subscription is no longer active — nothing was charged.' };
    case 'skipped_concurrent':
      return {
        variant: 'error',
        message: 'Another charge for this subscription was already in progress — nothing new was charged.',
      };
    case 'skipped_no_failed_row':
      return { variant: 'error', message: 'No failed charge was found to retry.' };
    case 'not_found':
      return { variant: 'error', message: 'Subscription not found.' };
    case 'invalid_amount':
      return { variant: 'error', message: 'Enter an amount greater than $0.' };
    case 'invalid_note':
      return { variant: 'error', message: 'A note is required to record a manual payment.' };
    case 'invalid_period':
      return { variant: 'error', message: 'Choose a period before recording the payment.' };
    default:
      return { variant: 'error', message: 'Unexpected outcome — nothing was charged.' };
  }
}

type ChargeMethod = 'card' | 'manual';
type ChargePeriod = 'full' | 'prorated';

// The dollar figure + breakdown for whichever period is selected — the
// SAME shape whether it came from options.fullMonth or options.prorated,
// so the display code below never needs to branch on which one it's
// showing (docs/plans/payment-airtight-plan.md D4).
function optionFor(preview: ChargePreview | null, period: ChargePeriod): ChargeOption | null {
  if (!preview || !preview.options) return null;
  return period === 'prorated' ? preview.options.prorated : preview.options.fullMonth;
}

interface ChargeDialogState {
  open: boolean;
  subscription: AdminSubscriptionRow | null;
  loading: boolean;
  preview: ChargePreview | null;
  loadError: string | null;
  // Charge card on file vs. record an offline payment (docs/plans/payment-
  // airtight-plan.md D4) — and, within the card/manual choice, which
  // period this charge covers.
  method: ChargeMethod;
  period: ChargePeriod;
  manualAmount: string;
  manualNote: string;
  charging: boolean;
  chargeError: string | null;
  result: ChargeResult | null;
}

const EMPTY_CHARGE_DIALOG: ChargeDialogState = {
  open: false,
  subscription: null,
  loading: false,
  preview: null,
  loadError: null,
  method: 'card',
  period: 'full',
  manualAmount: '',
  manualNote: '',
  charging: false,
  chargeError: null,
  result: null,
};

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

// Payment History (docs/plans/manual-charge-and-pdf-invoice-plan.md's
// 2026-08-31 addendum) — read-only, no "saving" state at all. `rows` is the
// WHOLE FAMILY's history (every child under this row's parent), fed by the
// same PaymentHistoryTable + invoiceDownloadUrl the parent portal uses.
interface HistoryDialogState {
  open: boolean;
  subscription: AdminSubscriptionRow | null;
  loading: boolean;
  rows: PaymentHistoryRow[];
  error: string | null;
}

const EMPTY_HISTORY_DIALOG: HistoryDialogState = {
  open: false,
  subscription: null,
  loading: false,
  rows: [],
  error: null,
};

async function fetchScheduleOptionsData() {
  const [schedules, groupClasses] = await Promise.all([fetchSchedules(), fetchGroupClasses()]);
  return { schedules, groupClasses };
}

export default function AdminSubscriptionsPage() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

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
  const [chargeDialog, setChargeDialog] = useState<ChargeDialogState>(EMPTY_CHARGE_DIALOG);
  const [historyDialog, setHistoryDialog] = useState<HistoryDialogState>(EMPTY_HISTORY_DIALOG);

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
    return `${groupClass ? groupClass.name : 'Class'} — ${DAY_LABELS[schedule.dayOfWeek]} ${formatTime(schedule.startTime)}-${formatTime(schedule.endTime)}`;
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

  // Manual Charge button (docs/plans/manual-charge-and-pdf-invoice-plan.md
  // PR 1) — loads the read-only preview on open so the dialog always shows
  // the exact amount/card-on-file state before the superadmin can confirm.
  async function openCharge(subscription: AdminSubscriptionRow) {
    setChargeDialog({ ...EMPTY_CHARGE_DIALOG, open: true, subscription, loading: true });

    const result = await fetchChargePreview(subscription._id);

    if (result.status === 'success') {
      setChargeDialog((prev) => ({ ...prev, loading: false, preview: result.data }));
    } else {
      setChargeDialog((prev) => ({ ...prev, loading: false, loadError: result.message }));
    }
  }

  function closeCharge() {
    if (chargeDialog.charging) return;
    setChargeDialog(EMPTY_CHARGE_DIALOG);
  }

  // Payment History (docs/plans/manual-charge-and-pdf-invoice-plan.md's
  // 2026-08-31 addendum) — loads the row's WHOLE FAMILY's history (same
  // scope the parent themselves sees at /parent/billing), not just this one
  // student's rows.
  async function openHistory(subscription: AdminSubscriptionRow) {
    setHistoryDialog({ ...EMPTY_HISTORY_DIALOG, open: true, subscription, loading: true });

    try {
      const rows = await fetchPaymentHistoryForParent(subscription.parentId._id);
      setHistoryDialog((prev) => ({ ...prev, loading: false, rows }));
    } catch (err) {
      setHistoryDialog((prev) => ({ ...prev, loading: false, error: getErrorMessage(err) }));
    }
  }

  function closeHistory() {
    setHistoryDialog(EMPTY_HISTORY_DIALOG);
  }

  // In dunning, a manual recording always targets the SAME overdue period
  // the locked failed row already targets ('full' — recordManualPayment's
  // own meaning for that period is exactly "the subscription's currently-
  // due period"), so there is no period to pick in that one combination.
  function effectivePeriodFor(preview: ChargePreview | null, method: ChargeMethod, period: ChargePeriod): ChargePeriod {
    return preview?.inDunning && method === 'manual' ? 'full' : period;
  }

  // Switching payment method re-prefills the manual amount from whichever
  // period is currently in effect — editable afterward, never re-clobbered
  // by anything else (docs/plans/payment-airtight-plan.md D4: "prefilled,
  // editable"). In dunning, the only sensible prefill is the locked
  // failed-row amount itself (preview.amount) — options aren't computed
  // for a dunning preview at all (renewal.service.js's previewRenewal
  // returns early on that branch).
  function selectMethod(method: ChargeMethod) {
    setChargeDialog((prev) => {
      if (method !== 'manual') {
        return { ...prev, method };
      }

      const effectivePeriod = effectivePeriodFor(prev.preview, method, prev.period);
      const prefill = prev.preview?.inDunning
        ? prev.preview.amount ?? 0
        : optionFor(prev.preview, effectivePeriod)?.amount ?? 0;

      return { ...prev, method, manualAmount: prefill.toFixed(2) };
    });
  }

  function selectPeriod(period: ChargePeriod) {
    setChargeDialog((prev) => {
      if (prev.method !== 'manual') {
        return { ...prev, period };
      }

      return { ...prev, period, manualAmount: (optionFor(prev.preview, period)?.amount ?? 0).toFixed(2) };
    });
  }

  async function submitCharge() {
    if (!chargeDialog.subscription) return;

    setChargeDialog((prev) => ({ ...prev, charging: true, chargeError: null }));

    const { subscription, preview, method, period, manualAmount, manualNote } = chargeDialog;
    const effectivePeriod = effectivePeriodFor(preview, method, period);

    const result =
      method === 'manual'
        ? await recordManualPayment(subscription._id, {
            amount: Number(manualAmount),
            note: manualNote,
            period: effectivePeriod,
          })
        : await chargeSubscription(subscription._id, effectivePeriod);

    if (result.status === 'success') {
      setChargeDialog((prev) => ({ ...prev, charging: false, result: result.data }));
      // Refresh the list in the background — Next billing / Last charge /
      // Status now reflect the outcome — but leave the dialog open so the
      // superadmin can read the result first (closed explicitly below).
      retry();
    } else {
      setChargeDialog((prev) => ({ ...prev, charging: false, chargeError: result.message }));
    }
  }

  // Gating for the Confirm button. `inDunning` + card intentionally
  // bypasses the `due` check — retryOne (unlike renewOne) never gates on
  // nextBillingDate, so a dunning card retry is always actionable, matching
  // what the backend actually enforces.
  const preview = chargeDialog.preview;
  const { method, period } = chargeDialog;
  const inDunningCardLock = Boolean(preview?.inDunning) && method === 'card';
  const effectivePeriod = effectivePeriodFor(preview, method, period);
  const selectedOption = preview ? optionFor(preview, effectivePeriod) : null;

  // "Already paid/not due" per period — 'full' stays gated by `due`
  // (unchanged from the original single-option dialog); 'prorated' is
  // gated by the ledger-sourced monthAlreadyPaid instead (D8), since it
  // deliberately bypasses `due`. Neither applies while in dunning (that
  // period is, definitionally, already overdue — not "not due yet") or
  // during a pending-cancellation finalize.
  const periodAlreadyPaid =
    !preview || preview.willFinalizeCancellation || preview.inDunning
      ? false
      : effectivePeriod === 'full'
        ? !preview.due
        : Boolean(preview.monthAlreadyPaid);

  // The "prorated from today" option is entirely absent when the
  // schedule/class/level chain can't be resolved (previewRenewal degrades
  // gracefully rather than failing the whole preview) — never true for the
  // dunning+manual case, which never offers 'prorated' as a choice at all.
  const periodUnavailable = !preview?.inDunning && effectivePeriod === 'prorated' && !selectedOption;

  const manualAmountNumber = Number(chargeDialog.manualAmount);
  const manualInvalid =
    method === 'manual' &&
    (!chargeDialog.manualAmount ||
      !Number.isFinite(manualAmountNumber) ||
      manualAmountNumber <= 0 ||
      chargeDialog.manualNote.trim().length === 0);

  const chargeConfirmDisabled =
    chargeDialog.loading ||
    chargeDialog.charging ||
    !preview ||
    preview.outcome !== 'previewable' ||
    (!preview.willFinalizeCancellation && method === 'card' && !preview.paymentMethod) ||
    (!preview.willFinalizeCancellation && !inDunningCardLock && (periodAlreadyPaid || periodUnavailable)) ||
    (!preview.willFinalizeCancellation && !inDunningCardLock && method === 'manual' && manualInvalid);

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
                <th className={styles.th}>Last payment</th>
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
                        {row.isPremium ? (
                          <span className={styles.chipMuted} style={{ marginLeft: 6 }}>
                            Premium — any session
                          </span>
                        ) : null}
                        <div className={styles.cellMuted}>{coachLine(row.scheduleId)}</div>
                      </td>
                      <td className={styles.td}>{formatDateLabel(row.nextBillingDate)}</td>
                      <td className={styles.td}>
                        {/* Sourced from the Registration ledger (docs/plans/
                            payment-airtight-plan.md D11) — the real total
                            actually charged, fee included. Never
                            Subscription.lastChargeAmount, which is
                            deliberately fee-free. */}
                        {row.lastPayment != null ? `$${row.lastPayment.amount.toFixed(2)}` : '—'}
                        {row.lastPayment?.chargeMethod === 'manual' ? (
                          <span className={styles.chipMuted} style={{ marginLeft: 6 }}>
                            Manual
                          </span>
                        ) : null}
                        {row.lastSiblingDiscountApplied ? (
                          <span className={styles.chipMuted} style={{ marginLeft: 6 }}>
                            10% sibling
                          </span>
                        ) : null}
                        {row.firstChargeProrated ? (
                          <span className={styles.chipMuted} style={{ marginLeft: 6 }}>
                            Prorated first month
                          </span>
                        ) : null}
                      </td>
                      <td className={styles.td}>
                        {isCancelled ? (
                          <span className={styles.chipMuted}>Cancelled</span>
                        ) : isPendingCancel ? (
                          <span className={styles.chip} style={{ background: 'var(--color-bg)', color: 'var(--color-accent)' }}>
                            Cancels {formatDateLabel(row.currentPeriodEnd)}
                          </span>
                        ) : (
                          <span className={`${styles.chip} ${styles.chipActive}`}>Active</span>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <div className={styles.actionBtns}>
                          <button type="button" className={styles.btnSecondary} onClick={() => openHistory(row)}>
                            Payment History
                          </button>
                          {(isActive || isPendingCancel) && !row.isPremium && (
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
                          {isSuperadmin && !isCancelled ? (
                            <button type="button" className={styles.btnPrimary} onClick={() => openCharge(row)}>
                              Charge
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

      <Modal
        open={changeDialog.open && changeDialog.subscription !== null}
        onClose={closeChangeSchedule}
        title="Change Schedule"
        disableClose={changeDialog.saving}
        footer={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={closeChangeSchedule}
              disabled={changeDialog.saving}
            >
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
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={submitChangeSchedule}
                disabled={changeDialog.saving}
              >
                {changeDialog.saving ? 'Saving…' : 'Confirm Change'}
              </button>
            )}
          </>
        }
      >
        {changeDialog.error ? <Alert variant="error">{changeDialog.error}</Alert> : null}

        {changeDialog.subscription ? (
          changeDialog.step === 'pick' ? (
            <>
              <div className={styles.formGroup}>
                <label className={styles.label}>Current schedule</label>
                <div className={styles.cellMuted}>
                  {changeDialog.subscription.scheduleId.classId.name} —{' '}
                  {scheduleLine(changeDialog.subscription.scheduleId)} ({coachLine(changeDialog.subscription.scheduleId)})
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
                    onChange={(e) => setChangeDialog((prev) => ({ ...prev, newScheduleId: e.target.value }))}
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
                  {scheduleLine(changeDialog.subscription.scheduleId)} ({coachLine(changeDialog.subscription.scheduleId)})
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>After</label>
                <div className={styles.cellMuted}>
                  {selectedNewGroupClass?.name} — {selectedNewSchedule ? scheduleLine(selectedNewSchedule) : ''}
                </div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Monthly fee unchanged — same level.</p>
            </>
          )
        ) : null}
      </Modal>

      <Modal
        open={cancelDialog.open && cancelDialog.subscription !== null}
        onClose={() => setCancelDialog({ open: false, subscription: null, saving: false, error: null })}
        title="Cancel Subscription"
        size="sm"
        hideCloseButton
        disableClose={cancelDialog.saving}
        footer={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={cancelDialog.saving}
              onClick={() => setCancelDialog({ open: false, subscription: null, saving: false, error: null })}
            >
              Keep Subscription
            </button>
            <button
              type="button"
              className={styles.btnDangerFilled}
              onClick={submitCancel}
              disabled={cancelDialog.saving}
            >
              {cancelDialog.saving ? 'Cancelling…' : 'Cancel Subscription'}
            </button>
          </>
        }
      >
        {cancelDialog.error ? <Alert variant="error">{cancelDialog.error}</Alert> : null}
        {cancelDialog.subscription ? (
          <p style={{ margin: 0 }}>
            Cancel {cancelDialog.subscription.studentId.firstName}&apos;s subscription? Classes continue through{' '}
            {formatDateLabel(cancelDialog.subscription.currentPeriodEnd)}; nothing is refunded and the subscription
            will not renew.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={reactivateDialog.open && reactivateDialog.subscription !== null}
        onClose={() => setReactivateDialog({ open: false, subscription: null, saving: false, error: null })}
        title="Reactivate Subscription"
        size="sm"
        hideCloseButton
        disableClose={reactivateDialog.saving}
        footer={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={reactivateDialog.saving}
              onClick={() => setReactivateDialog({ open: false, subscription: null, saving: false, error: null })}
            >
              Close
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={submitReactivate}
              disabled={reactivateDialog.saving}
            >
              {reactivateDialog.saving ? 'Reactivating…' : 'Remove Cancellation'}
            </button>
          </>
        }
      >
        {reactivateDialog.error ? <Alert variant="error">{reactivateDialog.error}</Alert> : null}
        <p style={{ margin: 0 }}>Remove the pending cancellation? Renewals continue as normal; nothing is charged now.</p>
      </Modal>

      <Modal
        open={chargeDialog.open && chargeDialog.subscription !== null}
        onClose={closeCharge}
        title="Charge Subscription"
        disableClose={chargeDialog.charging}
        footer={
          chargeDialog.result ? (
            <button type="button" className={styles.btnPrimary} onClick={closeCharge}>
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={closeCharge}
                disabled={chargeDialog.charging}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={submitCharge}
                disabled={chargeConfirmDisabled}
              >
                {chargeDialog.charging
                  ? 'Processing…'
                  : preview?.willFinalizeCancellation
                    ? 'Finalize'
                    : chargeDialog.method === 'manual'
                      ? 'Record Payment'
                      : 'Confirm Charge'}
              </button>
            </>
          )
        }
      >
        {chargeDialog.subscription ? (
          <div className={styles.formGroup}>
            <div style={{ fontWeight: 600 }}>
              {chargeDialog.subscription.studentId.firstName} {chargeDialog.subscription.studentId.lastName}
            </div>
            <div className={styles.cellMuted}>
              {chargeDialog.subscription.scheduleId.classId.name} —{' '}
              {chargeDialog.subscription.scheduleId.classId.levelId.name}
            </div>
          </div>
        ) : null}

        {chargeDialog.loading ? <p className={styles.cellMuted}>Loading preview…</p> : null}

        {chargeDialog.loadError ? <Alert variant="error">{chargeDialog.loadError}</Alert> : null}

        {chargeDialog.result ? (
          <Alert variant={describeChargeOutcome(chargeDialog.result).variant}>
            {describeChargeOutcome(chargeDialog.result).message}
          </Alert>
        ) : null}

        {!chargeDialog.result && preview && preview.outcome === 'previewable' ? (
          <>
            {preview.willFinalizeCancellation ? (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Billing period</label>
                  <div className={styles.cellMuted}>
                    {preview.periodStart ? formatDateLabel(preview.periodStart) : ''} –{' '}
                    {preview.periodEnd ? formatDateLabel(preview.periodEnd) : ''}
                  </div>
                </div>
                <Alert variant="success">
                  This subscription is pending cancellation. Processing will finalize the cancellation —
                  nothing is charged.
                </Alert>
              </>
            ) : (
              <>
                {/* Prominent, always-visible explanation whenever the
                    currently selected period is already paid (docs/plans/
                    booking-and-private-class-fixes-plan.md §5) — promoted
                    from a barely-visible muted line near the bottom of the
                    dialog to the top, above the method radios. Guard B
                    (one payment per subscription per calendar month, built
                    after a real $403.82 double-charge incident) is correct
                    and stays exactly as-is; what was broken was the
                    COMMUNICATION, not the rule — no override is added
                    here. Never shown during the dunning-card-lock path,
                    which has its own explanation below and deliberately
                    bypasses this due-date reasoning (retryOne never gates
                    on nextBillingDate). */}
                {!inDunningCardLock && periodAlreadyPaid ? (
                  <Alert variant="success">
                    {effectivePeriod === 'full'
                      ? `Already paid through this period. Not due until ${
                          preview.nextBillingDate ? formatDateLabel(preview.nextBillingDate) : '—'
                        } — the Confirm button unlocks then.`
                      : preview.monthAlreadyPaid
                        ? `This month is already paid — ${formatMoney(
                            preview.monthAlreadyPaid.amount
                          )} on ${formatInstant(preview.monthAlreadyPaid.paidAt)} (${
                            preview.monthAlreadyPaid.chargeMethod === 'manual' ? 'manual' : 'card'
                          }).`
                        : null}
                  </Alert>
                ) : null}

                <div className={styles.formGroup}>
                  <label className={styles.label}>How to collect</label>
                  <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        name="charge-method"
                        checked={method === 'card'}
                        onChange={() => selectMethod('card')}
                      />
                      Charge card on file
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="radio"
                        name="charge-method"
                        checked={method === 'manual'}
                        onChange={() => selectMethod('manual')}
                      />
                      Record offline payment
                    </label>
                  </div>
                </div>

                {inDunningCardLock ? (
                  <Alert variant="error">
                    Retry attempt {preview.retryCount} of{' '}
                    {(preview.retryCount ?? 0) + (preview.attemptsRemaining ?? 0)} — charging the locked amount
                    from the failed charge.
                  </Alert>
                ) : preview.inDunning ? (
                  <Alert variant="error">
                    This subscription is in dunning (retry {preview.retryCount} of{' '}
                    {(preview.retryCount ?? 0) + (preview.attemptsRemaining ?? 0)}). Recording a payment below
                    clears the retry cycle.
                  </Alert>
                ) : (
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Period covered</label>
                    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="charge-period"
                          checked={period === 'full'}
                          onChange={() => selectPeriod('full')}
                        />
                        Full month{preview.options ? ` — ${formatMoney(preview.options.fullMonth.amount)}` : ''}
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="charge-period"
                          checked={period === 'prorated'}
                          disabled={!preview.options?.prorated}
                          onChange={() => selectPeriod('prorated')}
                        />
                        Prorated from today
                        {preview.options?.prorated ? ` — ${formatMoney(preview.options.prorated.amount)}` : ' (unavailable)'}
                      </label>
                    </div>
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label className={styles.label}>Billing period</label>
                  <div className={styles.cellMuted}>
                    {selectedOption
                      ? `${formatDateLabel(selectedOption.periodStart)} – ${formatDateLabel(selectedOption.periodEnd)}`
                      : preview.periodStart && preview.periodEnd
                        ? `${formatDateLabel(preview.periodStart)} – ${formatDateLabel(preview.periodEnd)}`
                        : ''}
                  </div>
                </div>

                {selectedOption ? (
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Breakdown</label>
                    <div className={styles.cellMuted}>Monthly fee: {formatMoney(selectedOption.breakdown.monthlyFee)}</div>
                    {selectedOption.breakdown.siblingDiscountApplied ? (
                      <div className={styles.cellMuted}>
                        − {formatMoney(selectedOption.breakdown.siblingDiscountAmount)} sibling discount (10%)
                      </div>
                    ) : null}
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: 'var(--space-2)' }}>
                      Total: {formatMoney(selectedOption.amount)}
                    </div>
                  </div>
                ) : preview.inDunning && preview.breakdown ? (
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Breakdown</label>
                    <div className={styles.cellMuted}>Monthly fee: {formatMoney(preview.breakdown.monthlyFee)}</div>
                    {preview.breakdown.siblingDiscountApplied ? (
                      <div className={styles.cellMuted}>
                        − {formatMoney(preview.breakdown.siblingDiscountAmount)} sibling discount (10%)
                      </div>
                    ) : null}
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: 'var(--space-2)' }}>
                      Total: {formatMoney(preview.amount ?? 0)}
                    </div>
                  </div>
                ) : null}

                {method === 'card' ? (
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Card on file</label>
                    {preview.paymentMethod ? (
                      <div className={styles.cellMuted}>{formatCardLabel(preview.paymentMethod)}</div>
                    ) : (
                      <Alert variant="error">No card on file — this charge will fail.</Alert>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={styles.formGroup}>
                      <label className={styles.label} htmlFor="manual-amount">
                        Amount
                      </label>
                      <input
                        id="manual-amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        className={styles.input}
                        value={chargeDialog.manualAmount}
                        onChange={(e) => setChargeDialog((prev) => ({ ...prev, manualAmount: e.target.value }))}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label} htmlFor="manual-note">
                        Note
                      </label>
                      <textarea
                        id="manual-note"
                        className={styles.input}
                        style={{ minHeight: 64 }}
                        placeholder="e.g. Paid by check #1042"
                        value={chargeDialog.manualNote}
                        onChange={(e) => setChargeDialog((prev) => ({ ...prev, manualNote: e.target.value }))}
                      />
                      {/* A due period's Confirm can look stuck for no
                          visible reason when the only thing blocking it is
                          an empty note (docs/plans/booking-and-private-
                          class-fixes-plan.md §5) — this hint stays
                          accurate regardless of what else is or isn't
                          blocking, since a note actually is always
                          required to record a manual payment. */}
                      {chargeDialog.manualNote.trim().length === 0 ? (
                        <p className={styles.cellMuted}>A note is required to record an offline payment.</p>
                      ) : null}
                    </div>
                  </>
                )}

                {periodUnavailable ? (
                  <p className={styles.cellMuted}>
                    Couldn&apos;t resolve a schedule/level for this subscription — the prorated option is
                    unavailable.
                  </p>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {!chargeDialog.result && preview && preview.outcome !== 'previewable' ? (
          <Alert variant="error">
            {preview.outcome === 'not_found'
              ? 'Subscription not found.'
              : preview.outcome === 'inactive'
                ? 'This subscription is no longer active.'
                : preview.outcome === 'no_price'
                  ? 'Could not resolve a price for this class/level.'
                  : 'No failed charge was found to retry.'}
          </Alert>
        ) : null}

        {chargeDialog.chargeError ? <Alert variant="error">{chargeDialog.chargeError}</Alert> : null}
      </Modal>

      <Modal
        open={historyDialog.open && historyDialog.subscription !== null}
        onClose={closeHistory}
        title="Payment History"
        footer={
          <button type="button" className={styles.btnPrimary} onClick={closeHistory}>
            Close
          </button>
        }
      >
        {historyDialog.subscription ? (
          <p className={styles.cellMuted} style={{ marginTop: 0 }}>
            Every payment on file for {historyDialog.subscription.parentId.firstName}{' '}
            {historyDialog.subscription.parentId.lastName}&apos;s family, straight from our billing records.
          </p>
        ) : null}

        {historyDialog.error ? (
          <Alert variant="error">{historyDialog.error}</Alert>
        ) : (
          <PaymentHistoryTable rows={historyDialog.rows} loading={historyDialog.loading} />
        )}
      </Modal>
    </main>
  );
}
