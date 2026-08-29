import Link from 'next/link';

import type { PublicSpotlight } from '../../../lib/types';
import styles from './marketing.module.css';

interface TeamBandProps {
  coaches: PublicSpotlight[];
}

// Navy "our team" band mirroring the live WP site's home page section
// (docs/plans/wordpress-ui-alignment-plan.md, Phase 2). Heading/subheading
// copy is the owner's own, verbatim from the live site. Content is real
// coach data from GET /spotlights/public?type=coach — never hardcoded
// names; renders nothing when there are none published yet, same rule as
// every other home-page section (docs/features/public-site.md).
//
// Photos use a plain CSS background-image div, not next/image — imageUrl is
// an admin-entered, arbitrary URL (pasted or a Vercel Blob upload; see
// docs/features/public-site.md's Spotlight model), and next/image requires
// every remote source host to be allowlisted in next.config.js's
// remotePatterns, which an unbounded admin-entered URL can't satisfy.
// Matches SpotlightCard's existing, already-shipped pattern exactly.
export default function TeamBand({ coaches }: TeamBandProps) {
  if (coaches.length === 0) {
    return null;
  }

  return (
    <section className={`${styles.teamBand} ${styles.fullBleed}`}>
      <div className={styles.teamBandInner}>
        <span className={styles.eyebrow}>Our Team</span>
        <h2 className={styles.sectionTitle}>Guided by experience</h2>
        <p className={styles.teamSubcopy}>
          Our coaching and support team brings deep experience, thoughtful leadership, and a
          shared commitment to putting students first on and off the strip.
        </p>
        <div className={styles.teamGrid}>
          {coaches.map((coach) => (
            <div key={coach.name} className={styles.teamCard}>
              <div
                className={styles.teamCardPhoto}
                role="img"
                aria-label={coach.imageUrl ? coach.name : `Photo of ${coach.name} — coming soon`}
                style={
                  coach.imageUrl
                    ? {
                        backgroundImage: `url(${coach.imageUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              />
              <h3 className={styles.teamCardName}>{coach.name}</h3>
              {coach.title ? <p className={styles.teamCardTitle}>{coach.title}</p> : null}
            </div>
          ))}
        </div>
        <p className={styles.teamViewAll}>
          <Link href="/coaches">View all coaches &rarr;</Link>
        </p>
      </div>
    </section>
  );
}
