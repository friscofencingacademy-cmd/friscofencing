'use client';

import { useState } from 'react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchMyPrivateAvailability, fetchMyPrivateBookings } from '../../../lib/services/privateClassCoach';
import {
  cancelPrivateBooking,
  markPrivateAttendance,
  removePrivateAvailabilityRule,
} from '../../../lib/services/privateClass';
import { formatLessonTime, formatRuleRange, formatRuleSlot, personName } from '../../../lib/privateLessons';
import type { CoachPrivateAvailabilityRule, CoachPrivateBookingRow } from '../../../lib/types';
import ProtectedRoute from '../../components/ProtectedRoute';
import AppShell from '../../components/layout/AppShell';
import PublishAvailabilityDialog from '../../components/privateLessons/PublishAvailabilityDialog/PublishAvailabilityDialog';
import Alert from '../../components/ui/Alert/Alert';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/ui/shared.module.css';

// A coach's private lessons (docs/decisions/011-private-per-session-booking.md):
// mark attendance on lessons that have started (a Visit — no money moves),
// see and cancel upcoming bookings, and publish/remove availability.

type Tab = 'attendance' | 'upcoming' | 'availability';

const TABS: { key: Tab; label: string }[] = [
  { key: 'attendance', label: 'Needs attendance' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'availability', label: 'Availability' },
];

function studentOf(booking: CoachPrivateBookingRow): string {
  return personName(booking.studentId, 'Student no longer available');
}

function AttendanceTab() {
  const { data, error, isLoading, retry } = useLoadState(() => fetchMyPrivateBookings('unmarked'), []);
  const [target, setTarget] = useState<{ booking: CoachPrivateBookingRow; status: 'attended' | 'missed' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function confirm() {
    if (!target) return;
    setSaving(true);
    setSaveError(null);

    const result = await markPrivateAttendance(target.booking._id, target.status);

    setSaving(false);

    if (result.status === 'success') {
      setTarget(null);
      retry();
    } else {
      setSaveError(result.message);
    }
  }

  if (error) return <LoadError message={getErrorMessage(error)} onRetry={retry} />;
  if (isLoading || !data) return <p>Loading...</p>;

  return (
    <>
      {data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No lessons need attendance right now.</p>
        </Card>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Parent</th>
                <th>Lesson</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((booking) => (
                <tr key={booking._id}>
                  <td>{studentOf(booking)}</td>
                  <td>{personName(booking.parentId, 'Parent no longer available')}</td>
                  <td>{formatLessonTime(booking.startDate)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setSaveError(null);
                          setTarget({ booking, status: 'attended' });
                        }}
                      >
                        Attended
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSaveError(null);
                          setTarget({ booking, status: 'missed' });
                        }}
                      >
                        Missed
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.status === 'missed' ? 'Mark Missed' : 'Mark Attended'}
        size="sm"
        hideCloseButton
        disableClose={saving}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm} loading={saving}>
              Confirm
            </Button>
          </>
        }
      >
        {saveError ? <Alert variant="error">{saveError}</Alert> : null}
        <p style={{ margin: 0 }}>
          {target
            ? `Mark ${studentOf(target.booking)} ${target.status === 'missed' ? 'missed' : 'attended'} for ${formatLessonTime(
                target.booking.startDate
              )}?`
            : ''}
        </p>
      </Modal>
    </>
  );
}

function UpcomingTab() {
  const { data, error, isLoading, retry } = useLoadState(() => fetchMyPrivateBookings('upcoming'), []);
  const [target, setTarget] = useState<CoachPrivateBookingRow | null>(null);
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
  if (isLoading || !data) return <p>Loading...</p>;

  return (
    <>
      {data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No upcoming private lessons.</p>
        </Card>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Parent</th>
                <th>Lesson</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((booking) => (
                <tr key={booking._id}>
                  <td>{studentOf(booking)}</td>
                  <td>{personName(booking.parentId, 'Parent no longer available')}</td>
                  <td>{formatLessonTime(booking.startDate)}</td>
                  <td>
                    {booking.canCancel ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSaveError(null);
                          setTarget(booking);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Cancel Lesson"
        size="sm"
        hideCloseButton
        disableClose={saving}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={saving}>
              Keep Lesson
            </Button>
            <Button type="button" variant="danger" onClick={confirm} loading={saving}>
              Cancel Lesson
            </Button>
          </>
        }
      >
        {saveError ? <Alert variant="error">{saveError}</Alert> : null}
        <p style={{ margin: 0 }}>
          {target
            ? `Cancel ${studentOf(target)}'s lesson on ${formatLessonTime(
                target.startDate
              )}? The family gets the session back and an email.`
            : ''}
        </p>
      </Modal>
    </>
  );
}

function AvailabilityTab() {
  const { data, error, isLoading, retry } = useLoadState(fetchMyPrivateAvailability, []);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<CoachPrivateAvailabilityRule | null>(null);
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
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Button
          type="button"
          onClick={() => {
            setNotice(null);
            setPublishOpen(true);
          }}
        >
          Publish availability
        </Button>
      </div>

      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {isLoading || !data ? (
        <p>Loading...</p>
      ) : data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>You haven&apos;t published any private lesson times yet.</p>
        </Card>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Open</th>
                <th>Booked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((rule) => (
                <tr key={rule._id}>
                  <td>{formatRuleSlot(rule)}</td>
                  <td>{formatRuleRange(rule)}</td>
                  <td>{rule.bookedCount}</td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRemoveError(null);
                        setTarget(rule);
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <PublishAvailabilityDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublished={(count) => {
          setPublishOpen(false);
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
            <Button type="button" variant="secondary" onClick={() => setTarget(null)}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setTarget(null)} disabled={removing}>
                Keep
              </Button>
              <Button type="button" variant="danger" onClick={confirmRemove} loading={removing}>
                Remove
              </Button>
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

function CoachPrivateLessonsContent() {
  const [tab, setTab] = useState<Tab>('attendance');

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Private Lessons</h1>
      </div>

      <div role="tablist" aria-label="Private lessons" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {TABS.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={tab === key ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'attendance' ? <AttendanceTab /> : tab === 'upcoming' ? <UpcomingTab /> : <AvailabilityTab />}
    </main>
  );
}

export default function CoachPrivateLessonsPage() {
  return (
    <ProtectedRoute allowedRoles={['coach']}>
      <AppShell>
        <CoachPrivateLessonsContent />
      </AppShell>
    </ProtectedRoute>
  );
}
