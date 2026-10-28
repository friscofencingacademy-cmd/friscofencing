'use client';

import { Fragment, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Plus, X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchUsers } from '../../../lib/services/users';
import {
  fetchPrivateAvailabilityAdmin,
  fetchPrivateBookingsAdmin,
  fetchPrivatePurchasesAdmin,
} from '../../../lib/services/privateClassAdmin';
import { cancelPrivateBooking, removePrivateAvailabilityWindow } from '../../../lib/services/privateClass';
import { formatInstant } from '../../../lib/formatDate';
import { formatMoney } from '../../../lib/formatMoney';
import {
  type AvailabilityWindow,
  bookingStatusLabel,
  formatLessonTime,
  formatRuleRange,
  formatWindowDay,
  formatWindowLabel,
  formatWindowTime,
  groupAvailabilityWindows,
  packSavingsLabel,
  personName,
  slotCount,
  slotWindowOf,
  windowRemovalMessage,
} from '../../../lib/privateLessons';
import type { AdminPrivateAvailabilityRule, AdminPrivateBookingRow } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import PublishAvailabilityDialog from '../../components/privateLessons/PublishAvailabilityDialog/PublishAvailabilityDialog';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

// Private lessons, all coaches and families (docs/decisions/011-private-per-
// session-booking.md). Purchases are read-only (money is the ledger's);
// bookings can be cancelled (credit returned); availability can be published
// on a coach's behalf or removed.

type Tab = 'purchases' | 'bookings' | 'availability';

const TABS: { key: Tab; label: string }[] = [
  { key: 'purchases', label: 'Purchases' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'availability', label: 'Availability' },
];

function isKnownTab(value: string | null): value is Tab {
  return value === 'purchases' || value === 'bookings' || value === 'availability';
}

function statusChipClass(booking: AdminPrivateBookingRow): string {
  const label = bookingStatusLabel(booking);
  if (label === 'Attended') return `${styles.chip} ${styles.chipActive}`;
  if (label === 'Missed') return `${styles.chip} ${styles.chipFailed}`;
  if (label === 'Cancelled') return `${styles.chip} ${styles.chipMuted}`;
  return `${styles.chip} ${styles.chipNeutral}`;
}

function PurchasesTab() {
  const { data, error, isLoading, retry } = useLoadState(() => fetchPrivatePurchasesAdmin(), []);

  if (error) return <LoadError message={getErrorMessage(error)} onRetry={retry} />;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead className={styles.tHead}>
          <tr>
            <th className={styles.th}>Student</th>
            <th className={styles.th}>Parent</th>
            <th className={styles.th}>Coach</th>
            <th className={styles.th}>Length</th>
            <th className={styles.th}>Sessions left</th>
            <th className={styles.th}>Paid</th>
            <th className={styles.th}>Purchased</th>
          </tr>
        </thead>
        <tbody>
          {isLoading || !data ? (
            <AdminLoadingRow colSpan={7} />
          ) : data.length === 0 ? (
            <AdminEmptyRow colSpan={7} message="No private lesson purchases yet" />
          ) : (
            data.map(({ enrollment, remaining, payment }) => (
              <tr key={enrollment._id} className={styles.trHover}>
                <td className={styles.td}>{personName(enrollment.studentId, 'Student no longer available')}</td>
                <td className={styles.td}>
                  {personName(enrollment.parentId, 'Parent no longer available')}
                  {enrollment.parentId?.email ? <div className={styles.cellMuted}>{enrollment.parentId.email}</div> : null}
                </td>
                <td className={styles.td}>{personName(enrollment.coachId, 'Coach no longer available')}</td>
                <td className={styles.td}>{enrollment.sessionDurationMinutes} min</td>
                <td className={styles.td}>
                  {remaining} of {enrollment.quantity}
                </td>
                <td className={styles.td}>
                  {payment ? formatMoney(payment.amount) : '—'}
                  {payment && payment.savings > 0 ? (
                    <div className={styles.cellMuted}>{packSavingsLabel(payment.savings)}</div>
                  ) : null}
                </td>
                <td className={styles.td}>{formatInstant(enrollment.createdAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BookingsTab() {
  const { data, error, isLoading, retry } = useLoadState(() => fetchPrivateBookingsAdmin(), []);
  const [target, setTarget] = useState<AdminPrivateBookingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function confirm() {
    if (!target) return;
    setSaving(true);
    setSaveError(null);

    const result = await cancelPrivateBooking(target._id);

    setSaving(false);

    if (result.status === 'success') {
      setTarget(null);
      retry();
    } else {
      setSaveError(result.message);
    }
  }

  if (error) return <LoadError message={getErrorMessage(error)} onRetry={retry} />;

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead className={styles.tHead}>
            <tr>
              <th className={styles.th}>Lesson</th>
              <th className={styles.th}>Student</th>
              <th className={styles.th}>Coach</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th} style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {isLoading || !data ? (
              <AdminLoadingRow colSpan={5} />
            ) : data.length === 0 ? (
              <AdminEmptyRow colSpan={5} message="No private lesson bookings yet" />
            ) : (
              data.map((booking) => (
                <tr key={booking._id} className={styles.trHover}>
                  <td className={styles.td}>{formatLessonTime(booking.startDate)}</td>
                  <td className={styles.td}>{personName(booking.studentId, 'Student no longer available')}</td>
                  <td className={styles.td}>{personName(booking.coachId, 'Coach no longer available')}</td>
                  <td className={styles.td}>
                    <span className={statusChipClass(booking)}>{bookingStatusLabel(booking)}</span>
                  </td>
                  <td className={`${styles.td} ${styles.tdRight}`}>
                    {booking.canCancel ? (
                      <button
                        type="button"
                        className={styles.btnDanger}
                        onClick={() => {
                          setSaveError(null);
                          setTarget(booking);
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Cancel Booking"
        size="sm"
        hideCloseButton
        disableClose={saving}
        footer={
          <>
            <button type="button" className={styles.btnSecondary} onClick={() => setTarget(null)} disabled={saving}>
              Keep Booking
            </button>
            <button type="button" className={styles.btnDangerFilled} onClick={confirm} disabled={saving}>
              {saving ? 'Cancelling…' : 'Cancel Booking'}
            </button>
          </>
        }
      >
        {saveError ? <Alert variant="error">{saveError}</Alert> : null}
        <p style={{ margin: 0 }}>
          {target
            ? `Cancel ${personName(target.studentId, 'this student')}'s lesson on ${formatLessonTime(
                target.startDate
              )}? The session goes back to the family's balance. No money is refunded or charged.`
            : ''}
        </p>
      </Modal>
    </>
  );
}

async function fetchAvailabilityWithCoaches() {
  const [rules, coaches] = await Promise.all([fetchPrivateAvailabilityAdmin(), fetchUsers('coach')]);
  return { rules, coaches };
}

function AvailabilityTab({ publishOpen, onPublishClose }: { publishOpen: boolean; onPublishClose: () => void }) {
  const { data, error, isLoading, retry } = useLoadState(fetchAvailabilityWithCoaches, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<AvailabilityWindow<AdminPrivateAvailabilityRule> | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Rule ids of the windows showing their slots — by id, not window key, so
  // a window split by a single-slot removal stays open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const windows = data ? groupAvailabilityWindows(data.rules, (rule) => rule.coachId?._id ?? 'no-coach') : [];

  function isExpanded(slotWindow: AvailabilityWindow<AdminPrivateAvailabilityRule>): boolean {
    return slotWindow.rules.some((rule) => expanded.has(rule._id));
  }

  function toggleExpanded(slotWindow: AvailabilityWindow<AdminPrivateAvailabilityRule>) {
    const open = isExpanded(slotWindow);
    setExpanded((previous) => {
      const next = new Set(previous);
      slotWindow.rules.forEach((rule) => (open ? next.delete(rule._id) : next.add(rule._id)));
      return next;
    });
  }

  function askRemove(slotWindow: AvailabilityWindow<AdminPrivateAvailabilityRule>) {
    setRemoveError(null);
    setTarget(slotWindow);
  }

  async function confirmRemove() {
    if (!target) return;
    setRemoving(true);
    setRemoveError(null);

    const result = await removePrivateAvailabilityWindow(target.rules.map((rule) => rule._id));
    const { ok, message } = windowRemovalMessage(target, result);

    setRemoving(false);
    retry();

    if (ok) {
      setTarget(null);
      setNotice(message);
    } else {
      setRemoveError(message);
    }
  }

  if (error) return <LoadError message={getErrorMessage(error)} onRetry={retry} />;

  return (
    <>
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead className={styles.tHead}>
            <tr>
              <th className={styles.th}>Coach</th>
              <th className={styles.th}>Day</th>
              <th className={styles.th}>Window</th>
              <th className={styles.th}>Slot length</th>
              <th className={styles.th}>Slots</th>
              <th className={styles.th}>Open</th>
              <th className={styles.th}>Booked</th>
              <th className={styles.th} />
            </tr>
          </thead>
          <tbody>
            {isLoading || !data ? (
              <AdminLoadingRow colSpan={8} />
            ) : windows.length === 0 ? (
              <AdminEmptyRow colSpan={8} message="No private lesson availability published" />
            ) : (
              windows.map((slotWindow) => (
                <Fragment key={slotWindow.key}>
                  <tr className={styles.trHover}>
                    <td className={styles.td}>{personName(slotWindow.rules[0].coachId, 'Coach no longer available')}</td>
                    <td className={styles.td}>{formatWindowDay(slotWindow)}</td>
                    <td className={styles.td}>{formatWindowTime(slotWindow)}</td>
                    <td className={styles.td}>{slotWindow.durationMinutes} min</td>
                    <td className={styles.td}>
                      {slotWindow.rules.length > 1 ? (
                        <button
                          type="button"
                          className={styles.btnIcon}
                          aria-expanded={isExpanded(slotWindow)}
                          aria-label={`${isExpanded(slotWindow) ? 'Hide' : 'Show'} slots of ${formatWindowLabel(slotWindow)}`}
                          onClick={() => toggleExpanded(slotWindow)}
                        >
                          {slotWindow.rules.length}
                          <ChevronRight
                            size={14}
                            style={{
                              transform: isExpanded(slotWindow) ? 'rotate(90deg)' : undefined,
                              transition: 'transform 0.15s',
                            }}
                          />
                        </button>
                      ) : (
                        slotWindow.rules.length
                      )}
                    </td>
                    <td className={styles.td}>{formatRuleRange(slotWindow)}</td>
                    <td className={styles.td}>{slotWindow.bookedCount}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      {/* A window with upcoming bookings can't be removed —
                          the same rule the backend's DELETE enforces per slot.
                          Its open slots can still go one at a time below. */}
                      {slotWindow.bookedCount > 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          Has bookings — can&apos;t be removed
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Remove"
                          aria-label={`Remove ${formatWindowLabel(slotWindow)}`}
                          onClick={() => askRemove(slotWindow)}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                  {slotWindow.rules.length > 1 && isExpanded(slotWindow)
                    ? slotWindow.rules.map((rule) => {
                        const slot = slotWindowOf(slotWindow, rule);
                        return (
                          <tr key={slot.key}>
                            <td className={styles.td} colSpan={2} />
                            <td className={`${styles.td} ${styles.cellMuted}`} style={{ paddingLeft: 'var(--space-5)' }}>
                              {formatWindowTime(slot)}
                            </td>
                            <td className={styles.td} colSpan={3} />
                            <td className={`${styles.td} ${styles.cellMuted}`}>{slot.bookedCount}</td>
                            <td className={`${styles.td} ${styles.tdRight}`}>
                              {slot.bookedCount > 0 ? (
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                                  Booked — can&apos;t be removed
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                                  title="Remove this slot"
                                  aria-label={`Remove ${formatWindowLabel(slot)}`}
                                  onClick={() => askRemove(slot)}
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PublishAvailabilityDialog
        open={publishOpen}
        coaches={data ? data.coaches : []}
        onClose={onPublishClose}
        onPublished={(count) => {
          onPublishClose();
          setNotice(`Published ${slotCount(count)}.`);
          retry();
        }}
      />

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={removeError ? 'Cannot Remove' : 'Remove Availability'}
        size="sm"
        hideCloseButton
        disableClose={removing}
        footer={
          removeError ? (
            <button type="button" className={styles.btnSecondary} onClick={() => setTarget(null)}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className={styles.btnSecondary} onClick={() => setTarget(null)} disabled={removing}>
                Keep
              </button>
              <button type="button" className={styles.btnDangerFilled} onClick={confirmRemove} disabled={removing}>
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </>
          )
        }
      >
        <p style={{ margin: 0 }}>
          {removeError ??
            (target
              ? `Stop offering ${formatWindowLabel(target)} (${slotCount(target.rules.length)})? Families can no longer book them.`
              : '')}
        </p>
      </Modal>
    </>
  );
}

export default function AdminPrivateClassesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(isKnownTab(paramTab) ? paramTab : 'purchases');
  const [publishOpen, setPublishOpen] = useState(false);

  function selectTab(next: Tab) {
    setTab(next);
    router.replace(`/admin/private-classes?tab=${next}`);
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Private Classes" />
        {tab === 'availability' ? (
          <button type="button" className={styles.btnPrimary} onClick={() => setPublishOpen(true)}>
            <Plus size={14} /> Publish Availability
          </button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Private classes" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            style={{ border: 'none', cursor: 'pointer' }}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'purchases' ? (
        <PurchasesTab />
      ) : tab === 'bookings' ? (
        <BookingsTab />
      ) : (
        <AvailabilityTab publishOpen={publishOpen} onPublishClose={() => setPublishOpen(false)} />
      )}
    </main>
  );
}
