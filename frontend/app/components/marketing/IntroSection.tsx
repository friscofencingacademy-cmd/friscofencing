import Image from 'next/image';

import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// "Who we are" — mirrors the live WP site's home page section (docs/plans/
// wordpress-ui-alignment-plan.md, Phase 2). Copy is the owner's own,
// verbatim from the live site, captured 2026-08-29.
export default function IntroSection() {
  return (
    <section className={styles.introSection}>
      <div className={styles.introText}>
        <span className={styles.eyebrow}>Who we are</span>
        <h2 className={styles.sectionTitle}>A Thoughtful Approach to an Olympic Sport</h2>
        <p className={styles.heroSubcopy}>
          Fencing develops balance, decision-making, respect, and emotional control. With
          roots dating back centuries, it is one of the world&apos;s oldest organized sports
          and has been a core discipline of the modern Olympic Games since their inception.
          Often described as physical chess, fencing requires students to think ahead, adapt
          quickly, and remain composed under pressure&mdash;blending physical movement with
          strategic thinking in a way few sports do.
        </p>
        <Button as="a" href="/classes" variant="secondary">
          Learn More
        </Button>
      </div>
      <div className={styles.introPhoto}>
        <Image
          src="/marketing/who-we-are.png"
          alt="A student training at Frisco Fencing Academy"
          fill
          sizes="(max-width: 760px) 100vw, 50vw"
          className={styles.introPhotoImg}
        />
      </div>
    </section>
  );
}
