import type { ReactNode } from 'react';

import styles from './flow.module.css';

export interface FlowSectionProps {
  title?: string;
  children: ReactNode;
}

export default function FlowSection({ title, children }: FlowSectionProps) {
  return (
    <div className={styles.section}>
      {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
      {children}
    </div>
  );
}
