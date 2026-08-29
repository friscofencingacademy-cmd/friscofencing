import Card from '../ui/Card/Card';
import styles from './marketing.module.css';

// Shown above the signup form on /register (docs/plans/trial-registration-
// required-fields-plan.md §2.1) — so a parent sees what the trial actually
// involves right as they're creating an account. Copy adapted from the
// owner's own, already-live description of the trial class (their Kicksite
// signup page), not invented — same claims, reworded for this platform's
// voice.
export default function TrialInfoCard() {
  return (
    <Card>
      <span className={styles.eyebrow}>Free Trial Class</span>
      <h2 className={styles.sectionTitle}>Your First Class Is Free</h2>
      <div className={styles.trialInfoBody}>
        <p>
          Our free trial class gives new students the chance to experience Olympic fencing at
          Frisco Fencing Academy before enrolling in a program.
        </p>
        <p>During your trial, you&apos;ll join a coach-led beginner class and be introduced to:</p>
        <ul>
          <li>Basic fencing movements and footwork</li>
          <li>Fundamental rules and safety guidelines</li>
          <li>Introductory drills and blade work</li>
        </ul>
        <p>
          No prior fencing experience is required — it&apos;s designed to be fun, engaging, and
          beginner-friendly.
        </p>
        <p>
          <strong>What to bring:</strong> comfortable athletic clothing, athletic shoes, and a
          water bottle. All fencing equipment is provided by the academy.
        </p>
      </div>
    </Card>
  );
}
