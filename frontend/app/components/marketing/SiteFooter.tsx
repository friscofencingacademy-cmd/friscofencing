import Link from 'next/link';

import type { PublicLocation } from '../../../lib/types';
import styles from './marketing.module.css';

interface SiteFooterProps {
  locations: PublicLocation[];
}

// Navy footer for the three real public pages (/, /classes, /coaches) —
// docs/plans/wordpress-ui-alignment-plan.md, Phase 2. NOT used on flow/auth
// pages (/register, /login, /private-classes) per that plan's scope. Social
// links are the owner's own real accounts (verified against the live WP
// site's footer, 2026-08-29) — plain external links, no tracking.
export default function SiteFooter({ locations }: SiteFooterProps) {
  return (
    <footer className={`${styles.siteFooter} ${styles.fullBleed}`}>
      <div className={styles.siteFooterTop}>
        <div>
          <span className={styles.siteFooterWordmark}>Frisco Fencing Academy</span>
          {locations.length > 0 ? (
            <p className={styles.siteFooterLocations}>
              {locations.map((location, index) => (
                <span key={location.name}>
                  {index > 0 ? ' | ' : ''}
                  {/* A dedicated inner span for the name/address text alone
                      (no sibling <a> inside it) — keeps it a single, stable
                      text node regardless of whether the phone/email links
                      below render. */}
                  <span>
                    {location.name} · {location.address}
                  </span>
                  {/* phone/email (docs/plans/frontend-polish-plan.md PR 5.3)
                      — render a real link only when the owner has set one;
                      never a fabricated placeholder. */}
                  {location.phone ? (
                    <>
                      {' · '}
                      <a href={`tel:${location.phone}`}>{location.phone}</a>
                    </>
                  ) : null}
                  {location.email ? (
                    <>
                      {' · '}
                      <a href={`mailto:${location.email}`}>{location.email}</a>
                    </>
                  ) : null}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <ul className={styles.siteFooterNav}>
          <li>
            <Link href="/classes">Programs</Link>
          </li>
          <li>
            <Link href="/coaches">Our Team</Link>
          </li>
          <li>
            <Link href="/private-classes">Private Lessons</Link>
          </li>
          <li>
            <Link href="/login">Log In</Link>
          </li>
        </ul>

        <div className={styles.siteFooterSocial}>
          <a href="https://www.instagram.com/official_friscofencing/" target="_blank" rel="noreferrer">
            Instagram
          </a>
          <a href="https://www.youtube.com/@BrainsBehindBlades" target="_blank" rel="noreferrer">
            YouTube
          </a>
        </div>
      </div>

      <p className={styles.siteFooterCopyright}>&copy; 2026 Frisco Fencing Academy</p>
    </footer>
  );
}
