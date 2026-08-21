import type { ReactNode } from 'react';

import Button from '../../ui/Button/Button';
import styles from './flow.module.css';

export interface OrderSummaryLine {
  label: string;
  value: ReactNode;
}

export interface OrderSummaryProps {
  heading?: string;
  lines: OrderSummaryLine[];
  cta?: string;
  ctaDisabled?: boolean;
  ctaLoading?: boolean;
  onCta?: () => void;
  note?: string;
}

/** The advance/submit button for a flow step lives here — never duplicated elsewhere on the page. */
export default function OrderSummary({
  heading = 'Summary',
  lines,
  cta,
  ctaDisabled,
  ctaLoading,
  onCta,
  note,
}: OrderSummaryProps) {
  return (
    <div className={styles.summary}>
      <h2 className={styles.summaryHeading}>{heading}</h2>

      {lines.map((line) => (
        <div key={line.label} className={styles.summaryRow}>
          <span className={styles.summaryLabel}>{line.label}</span>
          <span className={styles.summaryValue}>{line.value}</span>
        </div>
      ))}

      {cta ? (
        <div className={styles.summaryCtaWrap}>
          <Button type="button" fullWidth disabled={ctaDisabled} loading={ctaLoading} onClick={onCta}>
            {cta}
          </Button>
        </div>
      ) : null}

      {note ? <p className={styles.summaryNote}>{note}</p> : null}
    </div>
  );
}
