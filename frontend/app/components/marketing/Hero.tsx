import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// Full-bleed navy band, restyled 2026-08-29 to mirror the live WP site's
// home page (docs/plans/wordpress-ui-alignment-plan.md, Phase 2). Chip and
// headline are the owner's own copy, verbatim from the live site.
//
// NOT a photo hero, despite the plan's original design calling for one: the
// plan's designated hero photo (GettyImages-1716935160-1-scaled.jpg, the WP
// site's own hero background) turned out to be a stock photo of children
// playing SOCCER — leftover "Eagle Elite" multi-sport theme content the WP
// site never replaced, same class of bug as the boilerplate subcopy text
// (see this file's earlier subcopy comment). Verified visually against a
// screenshot before shipping — caught here, not assumed from the plan doc.
// Showing it as Frisco Fencing Academy's own hero image would misrepresent
// the business, and substituting different stock art would just be
// inventing content the same way. A solid gradient is the safe fallback —
// the same "no verified photo yet" pattern this codebase already uses
// elsewhere (SpotlightCard's placeholder). Swap in a real hero photo here
// once the owner provides one.
//
// Subcopy is NOT copied from WP either: the live site's actual hero
// paragraph is its own separate piece of that same leftover boilerplate
// ("...a center to bring people together through sports") — this keeps the
// existing, accurate, fencing-specific subcopy instead.
export default function Hero() {
  return (
    <section className={`${styles.heroBand} ${styles.fullBleed}`}>
      <div className={styles.heroPhotoContent}>
        <span className={styles.heroChip}>Welcome to Frisco Fencing Academy</span>
        <h1 className={styles.heroTitle}>Olympic Fencing.</h1>
        <p className={styles.heroSubcopy}>
          Structured group classes from the first lesson through competitive bouting. Start
          with a free trial class and find out where your child fits.
        </p>
        <div className={styles.heroActions}>
          <Button as="a" href="/register" size="lg">
            Take a Trial Class
          </Button>
          <Button as="a" href="/register" variant="accent" size="lg">
            Enroll in a Program
          </Button>
        </div>
      </div>
    </section>
  );
}
