import styles from './admin.module.css';

interface AdminLoadingRowProps {
  colSpan: number;
}

/** Standard loading-state row for admin tables. */
export function AdminLoadingRow({ colSpan }: AdminLoadingRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.loadingCell}>
        <span className={styles.spinner} role="status" aria-label="Loading" />
      </td>
    </tr>
  );
}

interface AdminEmptyRowProps {
  colSpan: number;
  message?: string;
}

/** Standard empty-state row for admin tables. */
export function AdminEmptyRow({ colSpan, message = 'No records found' }: AdminEmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.emptyCell}>
        {message}
      </td>
    </tr>
  );
}
