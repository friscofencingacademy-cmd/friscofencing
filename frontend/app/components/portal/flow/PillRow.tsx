import styles from './flow.module.css';

export interface PillRowProps<T> {
  items: T[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSub?: (item: T) => string;
  /** Accessible label for the radiogroup as a whole, e.g. "Select a session". */
  ariaLabel: string;
}

// A wrapping row of pill buttons — the CKQ-style picker (adapted: Frisco's
// own crimson accent, not CKQ's navy/blue; and role="radiogroup"/"radio" semantics
// to match this codebase's own ChildPickerCards precedent, not CKQ's plain
// aria-pressed buttons). One selection at a time.
//
// Known limitation, inherited on purpose for consistency rather than fixed
// quietly here: like ChildPickerCards, this doesn't implement WAI-ARIA
// radiogroup arrow-key roving-tabindex — each pill is still a real <button>,
// so Tab/Enter/Space work, just not arrow-key cycling between pills.
export default function PillRow<T>({
  items,
  selectedKey,
  onSelect,
  getKey,
  getLabel,
  getSub,
  ariaLabel,
}: PillRowProps<T>) {
  return (
    <div className={styles.pillRow} role="radiogroup" aria-label={ariaLabel}>
      {items.map((item) => {
        const key = getKey(item);
        const selected = key === selectedKey;

        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.pill} ${selected ? styles.pillSelected : ''}`}
            onClick={() => onSelect(key)}
          >
            <span className={styles.pillLabel}>{getLabel(item)}</span>
            {getSub ? <span className={styles.pillSub}>{getSub(item)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
