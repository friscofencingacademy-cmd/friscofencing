import type { Level, Price } from '../../../../lib/types';
import styles from './flow.module.css';

export interface LevelPickerCardsProps {
  levels: Level[];
  prices: Price[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function priceFor(prices: Price[], levelId: string): Price | undefined {
  return prices.find((price) => price.levelId === levelId);
}

// Same visual language as ChildPickerCards (radio-cards, not a raw
// <select>) — replaces the old "Class" dropdown. A level and a GroupClass
// are 1:1 in practice (confirmed against real schedule data — className
// always equals levelName), so picking a level IS picking the class; a
// level with no configured Price can't be registered into and is disabled
// rather than offered as a dead-end selection.
export default function LevelPickerCards({ levels, prices, selectedId, onSelect }: LevelPickerCardsProps) {
  return (
    <div className={styles.childGrid} role="radiogroup" aria-label="Select a level">
      {levels.map((level) => {
        const price = priceFor(prices, level._id);
        const selected = level._id === selectedId;

        return (
          <button
            key={level._id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.childCard} ${selected ? styles.childCardSelected : ''}`}
            onClick={() => onSelect(level._id)}
            disabled={!price}
          >
            <span>
              <div className={styles.childName}>{level.name}</div>
              <div className={styles.childMeta}>
                {price ? `$${price.monthlyFee}/month` : 'Pricing not configured'}
              </div>
            </span>
          </button>
        );
      })}
    </div>
  );
}
