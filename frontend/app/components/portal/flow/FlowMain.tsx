import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './flow.module.css';

export interface FlowCrumb {
  label: string;
  href?: string;
}

interface FlowStepperProps {
  steps: string[];
  current: number;
}

export function FlowStepper({ steps, current }: FlowStepperProps) {
  return (
    <div className={styles.stepper} role="list" aria-label="Progress">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <span key={label} className={styles.stepItem} role="listitem">
            <span
              className={`${styles.stepCircle} ${done ? styles.stepCircleDone : ''} ${active ? styles.stepCircleActive : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              {done ? '✓' : index + 1}
            </span>
            <span className={`${styles.stepLabel} ${active ? styles.stepLabelActive : ''}`}>{label}</span>
            {index < steps.length - 1 ? (
              <span className={`${styles.stepConnector} ${done ? styles.stepConnectorDone : ''}`} aria-hidden="true" />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export interface FlowMainProps {
  crumbs: FlowCrumb[];
  eyebrow?: string;
  title: string;
  steps?: string[];
  current: number;
  summary?: ReactNode;
  singleColumn?: boolean;
  children: ReactNode;
}

export default function FlowMain({
  crumbs,
  eyebrow,
  title,
  steps,
  current,
  summary,
  singleColumn = false,
  children,
}: FlowMainProps) {
  return (
    <div className={styles.wrap}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span key={crumb.label}>
              {crumb.href && !isLast ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span className={isLast ? styles.breadcrumbCurrent : undefined}>{crumb.label}</span>
              )}
              {!isLast ? ' / ' : null}
            </span>
          );
        })}
      </nav>

      <div className={styles.titleBlock}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
      </div>

      {steps && steps.length > 0 ? <FlowStepper steps={steps} current={current} /> : null}

      {singleColumn ? (
        <div className={styles.singleCol}>{children}</div>
      ) : (
        <div className={styles.twoCol}>
          <div className={styles.mainCol}>{children}</div>
          {summary ? <div className={styles.sideCol}>{summary}</div> : null}
        </div>
      )}
    </div>
  );
}
