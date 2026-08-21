import styles from './admin.module.css';

interface AdminPageHeaderProps {
  title: string;
  /** Count shown as subtitle, e.g. "42 total" */
  count?: number | null;
  /** Override the subtitle text entirely */
  subtitle?: string;
}

/**
 * Standard admin page header — title + optional count/subtitle. Used at the
 * top of every admin page for visual consistency (Pattern A, Phase 1/2 of
 * docs/plans/ckq-ui-adoption-plan.md).
 */
export default function AdminPageHeader({ title, count, subtitle }: AdminPageHeaderProps) {
  const sub = subtitle ?? (count != null ? `${count} total` : null);

  return (
    <div className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {sub ? <p className={styles.pageSubtitle}>{sub}</p> : null}
    </div>
  );
}
