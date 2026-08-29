import type { ReactNode } from 'react';

import Button from '../../ui/Button/Button';
import styles from './flow.module.css';

export type OrderSummaryLineKind = 'default' | 'discount' | 'total' | 'note';

export interface OrderSummaryLine {
  label: string;
  value: ReactNode;
  // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
  // alignment-plan.md, Phase 3) — 'default' when omitted, so every existing
  // call site (book-trial, register-private) compiles and renders unchanged.
  // 'discount': crimson-tinted row (a savings line — sibling discount, a
  // waived-fee "you saved $X"). 'total': the "Due at enrollment" row —
  // large, divider above. 'note': a small muted line under its own row
  // (e.g. a discount's or waiver's explanation), not a summaryRow at all.
  kind?: OrderSummaryLineKind;
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
      <span className={styles.summaryOverline}>Live Quote</span>
      <h2 className={styles.summaryHeading}>{heading}</h2>

      {lines.map((line) =>
        line.kind === 'note' ? (
          <p key={line.label} className={styles.summaryLineNote}>
            {line.value}
          </p>
        ) : (
          <div
            key={line.label}
            className={
              line.kind === 'total'
                ? `${styles.summaryRow} ${styles.summaryRowTotal}`
                : styles.summaryRow
            }
          >
            <span className={styles.summaryLabel}>{line.label}</span>
            <span
              className={
                line.kind === 'discount'
                  ? `${styles.summaryValue} ${styles.summaryValueDiscount}`
                  : styles.summaryValue
              }
            >
              {line.value}
            </span>
          </div>
        )
      )}

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
