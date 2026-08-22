import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// Static copy — deliberately claim-free (no ages, equipment, or counts
// that would need verifying). Option A from the approved hero copy.
export default function Hero() {
  return (
    <section className={styles.twoColGrid}>
      <div>
        <span className={styles.eyebrow}>Now Enrolling</span>
        <h1 className={styles.heroTitle}>Where Frisco learns to fence.</h1>
        <p className={styles.heroSubcopy}>
          Structured group classes from the first lesson through competitive bouting. Start
          with a free trial class and find out where your child fits.
        </p>
        <div className={styles.heroActions}>
          <Button as="a" href="/register" size="lg">
            Book a Free Trial
          </Button>
          <Button as="a" href="/classes" variant="secondary" size="lg">
            See the Schedule
          </Button>
        </div>
      </div>
      <div className={styles.photoPlaceholder} role="img" aria-label="Photo of the salle, coming soon">
        Photo of the salle — coming soon
      </div>
    </section>
  );
}
