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
    <section>
      <span className={styles.eyebrow}>Levels &amp; Pricing</span>
      <h2 className={styles.sectionTitle}>Every level, one monthly rate.</h2>
      <p className={styles.heroSubcopy}>
        Read live from the backend — whatever is set in admin is what appears here.
      </p>
      <div className={styles.levelGrid}>
        {levels.map((level) => (
          <Card key={level.name}>
            <span className={styles.levelOrder}>Level {level.order}</span>
            <h3 className={styles.levelName}>{level.name}</h3>
            <p className={styles.levelFee}>${level.monthlyFee}/month</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
