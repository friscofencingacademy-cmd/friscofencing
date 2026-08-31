'use client';

import { useParams } from 'next/navigation';

import { useLoadState, getErrorMessage } from '../../../../../lib/hooks/useLoadState';
import { fetchSessionsBySchedule } from '../../../../../lib/services/scheduling';
import { formatDateOnly } from '../../../../../lib/formatDate';
import Button from '../../../../components/ui/Button/Button';
import LoadError from '../../../../components/ui/LoadError/LoadError';
import AdminPageHeader from '../../../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../../../components/admin/AdminTableRows';
import styles from '../../../../components/admin/admin.module.css';

export default function SessionsPage() {
  const params = useParams<{ id: string }>();
  const scheduleId = params.id;

  const { data: sessions, error, isLoading, retry } = useLoadState(
    () => fetchSessionsBySchedule(scheduleId),
    [scheduleId]
  );

  return (
    <main>
      <AdminPageHeader title="Sessions" count={isLoading ? undefined : sessions?.length ?? 0} />

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Students</th>
                <th className={styles.th} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={3} />
              ) : !sessions || sessions.length === 0 ? (
                <AdminEmptyRow colSpan={3} message="No sessions found" />
              ) : (
                sessions.map((session) =>
                  session.isHoliday ? (
                    // Holiday-date session (docs/plans/holiday-blocking-plan.md
                    // D6) — annotated, not dropped, so the row still explains
                    // itself; no attendance link is rendered at all, since
                    // markAttendance rejects a holiday date with a 400 anyway.
                    <tr key={session._id} className={styles.trHover}>
                      <td className={`${styles.td} ${styles.cellMuted}`}>{formatDateOnly(session.date)}</td>
                      <td className={styles.td}>
                        <span className={`${styles.chip} ${styles.chipMuted}`}>Holiday — {session.holidayName}</span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`} />
                    </tr>
                  ) : (
                    <tr key={session._id} className={styles.trHover}>
                      <td className={styles.td}>{formatDateOnly(session.date)}</td>
                      <td className={styles.td}>{session.students.length}</td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <Button as="a" href={`/sessions/${session._id}/attendance`} size="sm" variant="secondary">
                          Mark Attendance
                        </Button>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
