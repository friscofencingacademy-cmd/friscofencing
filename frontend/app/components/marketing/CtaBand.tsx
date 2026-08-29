import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// Closing CTA band — restyled 2026-08-29 to mirror the live WP site's
// crimson "Join Our Community" band (docs/plans/wordpress-ui-alignment-plan
// .md, Phase 2). Heading is the owner's own copy, verbatim from the live
// site.
export default function CtaBand() {
  return (
    <section className={`${styles.ctaBand} ${styles.fullBleed}`}>
      <div className={styles.ctaBandInner}>
        <h2 className={styles.ctaBandTitle}>Join Our Community</h2>
        <p className={styles.ctaBandSubtitle}>The first class is free. It takes two minutes to book.</p>
        <div className={styles.heroActions} style={{ justifyContent: 'center' }}>
          <Button as="a" href="/register" variant="secondary" size="lg">
            Take a Trial Class
          </Button>
          <Button as="a" href="/register" size="lg">
            Enroll in a Program
          </Button>
        </div>
      </div>
    </section>
  );
}
