import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

export default function CtaBand() {
  return (
    <section className={styles.ctaBand}>
      <h2 className={styles.ctaBandTitle}>Ready to try a class?</h2>
      <p className={styles.ctaBandSubtitle}>The first one is free. It takes two minutes to book.</p>
      <Button as="a" href="/register" size="lg">
        Book a Free Trial
      </Button>
    </section>
  );
}
