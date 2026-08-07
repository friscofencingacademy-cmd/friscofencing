import type { ReactNode } from 'react';

import styles from './Alert.module.css';

interface AlertProps {
  variant: 'success' | 'error';
  children: ReactNode;
}

export default function Alert({ variant, children }: AlertProps) {
  const role = variant === 'error' ? 'alert' : 'status';

  return (
    <div className={`${styles.alert} ${styles[variant]}`} role={role}>
      {children}
    </div>
  );
}
