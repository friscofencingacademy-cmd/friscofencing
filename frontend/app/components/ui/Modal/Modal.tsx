'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import styles from './Modal.module.css';

export interface ModalProps {
  /** Whether the modal is open. Renders nothing at all when false. */
  open: boolean;
  /** Called on X click or Escape — never on a backdrop click. There is
   * deliberately no backdrop-click handler anywhere in this component; that
   * omission is the whole point (docs/plans/shared-modal-component-plan.md
   * — a misclick outside a dialog used to silently discard the form). */
  onClose: () => void;
  /** Dialog title, rendered in the header. */
  title: string;
  /** Accessible name for role="dialog"; falls back to `title` when omitted. */
  ariaLabel?: string;
  /** 'md' (default, 500px) or 'sm' (380px) — confirm/secondary dialogs use 'sm'. */
  size?: 'md' | 'sm';
  /** Hides the header's X button entirely — for a pure confirm dialog that
   * only ever offered Cancel/Delete (or a single Close) in its footer. */
  hideCloseButton?: boolean;
  /** True while an in-flight save/delete is happening. Disables the X and
   * makes Escape a no-op; the caller's own footer buttons keep managing
   * their own `disabled` state exactly as before — Modal doesn't own the
   * footer's content. */
  disableClose?: boolean;
  /** Dialog body content. */
  children: ReactNode;
  /** Dialog footer content (typically Cancel + a primary action). Omitted
   * entirely renders no footer row at all. */
  footer?: ReactNode;
}

export default function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  size = 'md',
  hideCloseButton = false,
  disableClose = false,
  children,
  footer,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Read fresh inside the effect without re-subscribing the keydown listener
  // on every render — the effect below intentionally only re-runs on `open`.
  const onCloseRef = useRef(onClose);
  const disableCloseRef = useRef(disableClose);
  onCloseRef.current = onClose;
  disableCloseRef.current = disableClose;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !disableCloseRef.current) {
        onCloseRef.current();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={size === 'sm' ? `${styles.dialog} ${styles.dialogSm}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
      >
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          {!hideCloseButton ? (
            <button
              type="button"
              className={styles.dialogClose}
              onClick={onClose}
              disabled={disableClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}
