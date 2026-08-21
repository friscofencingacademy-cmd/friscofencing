import Button from '../Button/Button';
import styles from './LoadError.module.css';

export interface LoadErrorProps {
  /** Display-safe message — pass the result of getErrorMessage(err). */
  message?: string;
  /** Omit to render without a retry action. */
  onRetry?: () => void;
  /** Smaller footprint for use inside cards/rows rather than a full page. */
  compact?: boolean;
}

const DEFAULT_MESSAGE = "Couldn't load this — please try again.";

/**
 * Inline error block rendered IN PLACE of failed content — never a modal,
 * never a full-page takeover.
 */
export default function LoadError({ message, onRetry, compact = false }: LoadErrorProps) {
  const classes = compact ? `${styles.loadError} ${styles.compact}` : styles.loadError;

  return (
    <div className={classes} role="alert">
      <p className={styles.message}>{message || DEFAULT_MESSAGE}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
