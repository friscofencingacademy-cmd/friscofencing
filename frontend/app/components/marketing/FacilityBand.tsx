import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// Facility stats — static, owner-authored copy verbatim from the live WP
// site (captured 2026-08-29), not backend data and not animated counters
// (docs/plans/wordpress-ui-alignment-plan.md, Phase 2, decision D4 — same
// status as Hero's copy; the design system's exclusion targets
// *animated/unverifiable* counters, and these are the owner's own
// published claims, dated here for anyone auditing later).
const STATS: { value: string; label: string }[] = [
  { value: '10', label: 'Strip' },
  { value: '5+', label: 'Dedicated trainers' },
  { value: '7 Days', label: 'Open all day' },
];

export default function FacilityBand() {
  return (
    <section className={styles.facilityBand}>
      <span className={styles.eyebrow}>Our Facility</span>
      {/* Verbatim from the live WP site — the global uppercase heading
          style renders this the same as WP's own display regardless of
          source casing. */}
      <h2 className={styles.sectionTitle}>The new facility - ffa 2.0</h2>
      <p className={styles.heroSubcopy}>
        {/* "min" -> "mind": the live source has a typo here; corrected as a
            minor editorial fix, not an invented claim. */}
        Our new Frisco facility was designed with one goal in mind: to create a calmer, safer,
        and more effective training environment for young fencers. Every element from the open
        floor plan to the dedicated training zones exists to support focus, movement, and
        progression without distraction.
      </p>
      <Button as="a" href="/classes" variant="secondary">
        Check our offerings
      </Button>
      <div className={styles.statsRow}>
        {STATS.map((stat) => (
          <div key={stat.label} className={styles.statItem}>
            <span className={styles.statValue}>{stat.value}</span>
            <span className={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
