import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import styles from './flow.module.css';

export interface FlowConfirmationLine {
  label: string;
  value: ReactNode;
}

export interface FlowConfirmationProps {
  title: string;
  subtitle?: string;
  lines?: FlowConfirmationLine[];
  links?: ReactNode;
}

export default function FlowConfirmation({ title, subtitle, lines, links }: FlowConfirmationProps) {
  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmCheck} aria-hidden="true">
        <Check size={28} />
      </div>
      <h2 className={styles.confirmTitle}>{title}</h2>
      {subtitle ? <p className={styles.confirmSubtitle}>{subtitle}</p> : null}

      {lines && lines.length > 0 ? (
        <div className={styles.confirmGrid}>
          {lines.map((line) => (
            <div key={line.label}>
              <div className={styles.confirmGridLabel}>{line.label}</div>
              <div className={styles.confirmGridValue}>{line.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {links ? <div className={styles.confirmActions}>{links}</div> : null}
    </div>
  );
}
