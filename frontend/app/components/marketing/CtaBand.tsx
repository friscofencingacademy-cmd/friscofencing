import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

export default function CtaBand() {
  return (
    <section className={styles.ctaBand}>
      <h2 className={styles.ctaBandTitle}>Ready to get started?</h2>
      <Button as="a" href="/register" size="lg">
        Book a Free Trial
      </Button>
    </section>
  );
}
