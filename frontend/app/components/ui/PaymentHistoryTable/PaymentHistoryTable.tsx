import { formatDateOnly, formatInstant } from '../../../../lib/formatDate';
import { invoiceDownloadUrl } from '../../../../lib/services/parent';
import type { PaymentHistoryRow } from '../../../../lib/types';
import Card from '../Card/Card';
import styles from '../shared.module.css';

// Props-driven, no fetching of its own (docs/plans/payment-airtight-plan.md
// D10) — the parent billing page is this component's first mount, but the
// shape is deliberately generic (rows in, nothing else) so an admin
// user-detail page can reuse it verbatim against its own endpoint later,
// with zero changes here.
export interface PaymentHistoryTableProps {
  rows: PaymentHistoryRow[];
  loading: boolean;
}

// periodStart/periodEnd are calendar-day sentinels — formatDateOnly renders
// them UTC-anchored, never browser-local. paidAt/createdAt/sessionDate are
// real instants — formatInstant renders them in the academy's own timezone.
// docs/plans/utc-date-standard-plan.md.
function formatPeriod(row: PaymentHistoryRow): string | null {
  if (row.periodStart && row.periodEnd) {
    return `${formatDateOnly(row.periodStart)} – ${formatDateOnly(row.periodEnd)}`;
  }
  if (row.sessionDate) {
    return formatInstant(row.sessionDate);
  }
  return null;
}

function statusLabel(status: PaymentHistoryRow['status']): string {
  if (status === 'completed') return 'Paid';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

export default function PaymentHistoryTable({ rows, loading }: PaymentHistoryTableProps) {
  if (loading) {
    return (
      <Card>
        <p>Loading...</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <p className={styles.emptyState}>No payments yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Student</th>
              <th>For</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Method</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const periodLine = formatPeriod(row);

              return (
                <tr key={row._id}>
                  <td>{formatInstant(row.paidAt ?? row.createdAt)}</td>
                  <td>{row.studentName}</td>
                  <td>
                    {row.description}
                    {periodLine ? (
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{periodLine}</div>
                    ) : null}
                  </td>
                  <td>${row.amount.toFixed(2)}</td>
                  <td>{statusLabel(row.status)}</td>
                  <td>
                    {row.chargeMethod === 'manual' ? (
                      <>
                        <span className={`${styles.chip} ${styles.chipMuted}`}>Manual</span>
                        {row.manualNote ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{row.manualNote}</div>
                        ) : null}
                      </>
                    ) : (
                      'Card'
                    )}
                  </td>
                  <td>
                    {row.invoiceAvailable ? (
                      <a href={invoiceDownloadUrl(row._id)} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
