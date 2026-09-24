'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchUsers } from '../../../lib/services/users';
import {
  fetchPrivateAvailabilityAdmin,
  fetchPrivateBookingsAdmin,
  fetchPrivatePurchasesAdmin,
} from '../../../lib/services/privateClassAdmin';
import { cancelPrivateBooking, removePrivateAvailabilityRule } from '../../../lib/services/privateClass';
import { formatInstant } from '../../../lib/formatDate';
import { formatMoney } from '../../../lib/formatMoney';
import {
  bookingStatusLabel,
  formatLessonTime,
  formatRuleRange,
  formatRuleSlot,
  personName,
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
                  {enrollment.discountPercent > 0 ? (
                    <div className={styles.cellMuted}>{enrollment.discountPercent}% pack discount</div>
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
  const [target, setTarget] = useState<AdminPrivateAvailabilityRule | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!target) return;
    setRemoving(true);
    setRemoveError(null);

    const result = await removePrivateAvailabilityRule(target._id);

    setRemoving(false);

    if (result.status === 'success') {
      setTarget(null);
      setNotice(result.data === 'retired' ? 'Slot closed — its past lessons stay on record.' : 'Slot removed.');
      retry();
    } else {
      setRemoveError(result.message);
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
              <th className={styles.th}>Slot</th>
              <th className={styles.th}>Open</th>
              <th className={styles.th}>Booked</th>
              <th className={styles.th} style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {isLoading || !data ? (
              <AdminLoadingRow colSpan={5} />
            ) : data.rules.length === 0 ? (
              <AdminEmptyRow colSpan={5} message="No private lesson availability published" />
            ) : (
              data.rules.map((rule) => (
                <tr key={rule._id} className={styles.trHover}>
                  <td className={styles.td}>{personName(rule.coachId, 'Coach no longer available')}</td>
                  <td className={styles.td}>{formatRuleSlot(rule)}</td>
                  <td className={styles.td}>{formatRuleRange(rule)}</td>
                  <td className={styles.td}>{rule.bookedCount}</td>
                  <td className={`${styles.td} ${styles.tdRight}`}>
                    <button
                      type="button"
                      className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                      title="Remove"
                      aria-label={`Remove ${formatRuleSlot(rule)}`}
                      onClick={() => {
                        setRemoveError(null);
                        setTarget(rule);
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

      <PublishAvailabilityDialog
        open={publishOpen}
        coaches={data ? data.coaches : []}
        onClose={onPublishClose}
        onPublished={(count) => {
          onPublishClose();
          setNotice(`Published ${count} slot${count === 1 ? '' : 's'}.`);
          retry();
        }}
      />

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={removeError ? 'Cannot Remove' : 'Remove Slot'}
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
          {removeError ?? (target ? `Stop offering ${formatRuleSlot(target)}? Families can no longer book it.` : '')}
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
