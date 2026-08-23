import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// A factual description of the real auth flow (create account -> add
// child -> pick a trial), not marketing copy — keep this wording aligned
// with the actual step labels in /parent/book-trial if those ever change.
const STEPS = [
  'Create your free account',
  'Add your child',
  'Pick a free trial class',
];

export default function StepsRow() {
  return (
    <section>
      <span className={styles.eyebrow}>Getting Started</span>
      <h2 className={styles.sectionTitle}>Three steps to your first class.</h2>
      <div className={styles.stepsRow}>
        {STEPS.map((step, index) => (
          <div key={step}>
            <span className={styles.stepNumber}>{index + 1}</span>
            <p className={styles.stepLabel}>{step}</p>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <Button as="a" href="/register" size="lg">
          Book a Free Trial
        </Button>
      </div>
    </section>
  );
}
