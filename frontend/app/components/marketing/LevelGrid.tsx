import type { PublicLevel } from '../../../lib/types';
import Card from '../ui/Card/Card';
import styles from './marketing.module.css';

interface LevelGridProps {
  levels: PublicLevel[];
}

// One card per level: name + monthlyFee formatted as "$N/month", ordered
// by `order` (the backend already returns them sorted). No description —
// Level has no such field; that would be invented copy.
export default function LevelGrid({ levels }: LevelGridProps) {
  return (
    <div className={styles.levelGrid}>
      {levels.map((level) => (
        <Card key={level.name}>
          <h3 className={styles.levelName}>{level.name}</h3>
          <p className={styles.levelFee}>${level.monthlyFee}/month</p>
        </Card>
      ))}
    </div>
  );
}
