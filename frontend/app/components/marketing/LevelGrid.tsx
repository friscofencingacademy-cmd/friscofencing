import Image from 'next/image';

import type { PublicLevel } from '../../../lib/types';
import Button from '../ui/Button/Button';
import Card from '../ui/Card/Card';
import styles from './marketing.module.css';

interface LevelGridProps {
  levels: PublicLevel[];
}

// Photo header per card, mirroring the live WP site's Beginner/Intermediate/
// Advanced program cards (docs/plans/wordpress-ui-alignment-plan.md, Phase
// 2) — mapped by the level's own `order` field, not by name matching (a
// level could be renamed without changing its position). A 4th+ level, or
// one whose order has no mapped photo, gets a plain navy header instead of
// a missing image — never a stale/wrong photo.
const PROGRAM_PHOTOS = [
  '/marketing/program-beginner.jpg',
  '/marketing/program-intermediate.jpg',
  '/marketing/program-advanced.png',
];

// One card per level: name + monthlyFee formatted as "$N/month", ordered
// by `order` (the backend already returns them sorted). No description —
// Level has no such field; that would be invented copy.
export default function LevelGrid({ levels }: LevelGridProps) {
  return (
    <section>
      <span className={styles.eyebrow}>Programs</span>
      <h2 className={styles.sectionTitle}>A clear path for every stage</h2>
      <p className={styles.heroSubcopy}>
        Our programs are designed to meet students where they are and guide them forward with
        structure, care, and consistency.
      </p>
      <div className={styles.levelGrid}>
        {levels.map((level) => {
          const photo = PROGRAM_PHOTOS[level.order - 1];

          return (
            <Card key={level.name}>
              {photo ? (
                <div className={styles.levelCardPhoto}>
                  <Image src={photo} alt="" fill sizes="(max-width: 760px) 100vw, 33vw" />
                </div>
              ) : (
                <div className={styles.levelCardPhotoFallback} aria-hidden="true" />
              )}
              <div className={styles.levelCardBody}>
                <span className={styles.levelOrder}>Level {level.order}</span>
                <h3 className={styles.levelName}>{level.name}</h3>
                <p className={styles.levelFee}>${level.monthlyFee}/month</p>
                <Button as="a" href="/register" variant="secondary" size="sm">
                  Take a Trial Class
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
