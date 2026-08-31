'use client';

import { useEffect, useState } from 'react';

import { fetchMyPaymentHistory } from '../../../lib/services/parent';
import type { PaymentHistoryRow } from '../../../lib/types';
import PaymentHistoryTable from '../../components/ui/PaymentHistoryTable/PaymentHistoryTable';
import styles from '../../components/ui/shared.module.css';

export default function ParentBillingPage() {
  const [rows, setRows] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchMyPaymentHistory()
      .then((history) => {
        if (!cancelled) setRows(history);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Payment History</h1>
        <p className={styles.pageSubtitle}>Every charge on file for your family, straight from our billing records.</p>
      </div>

      <PaymentHistoryTable rows={rows} loading={loading} />
    </main>
  );
}
