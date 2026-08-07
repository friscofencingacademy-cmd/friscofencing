import type { ReactNode } from 'react';

import styles from './Card.module.css';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export default function Card({ children, className }: CardProps) {
  const classes = className ? `${styles.card} ${className}` : styles.card;

  return <div className={classes}>{children}</div>;
}
