import type { PublicLocation } from '../../../lib/types';
import styles from './marketing.module.css';

interface ContactBlockProps {
  locations: PublicLocation[];
}

// Renders right after the hero, unconditionally — the home page's one
// concession to a total backend outage (docs/plans/frontend-polish-plan.md
// PR 5.3, source-of-truth audit finding B8). Two layers:
//
// - STATIC, zero fetch dependency: academy name + the existing YouTube
//   link + a "call or email to book" line. Always renders, even when every
//   home-page fetch has failed — a stranger sees a way to reach the
//   academy instead of hero-marquee-nothing.
// - FETCH-DRIVEN enrichment: each location's real phone/email/address,
//   sourced from GET /locations/public — only when `locations` has data.
//   Accepted, explicit limit: in a full outage the DB-held details are
//   unavailable by construction. That's the cost of keeping contact info
//   in the DB (admin-editable, backend stays the source of truth) instead
//   of hardcoding a copy that could silently drift from the admin's real
//   values — the same contradiction risk source-of-truth audit finding B5
//   warns about for other static marketing copy.
export default function ContactBlock({ locations }: ContactBlockProps) {
  return (
    <div className={styles.contactBlock}>
      <p className={styles.contactBlockStatic}>
        Frisco Fencing Academy — call or email us to book a class, or watch us on{' '}
        <a href="https://www.youtube.com/@BrainsBehindBlades" target="_blank" rel="noreferrer">
          YouTube
        </a>
        .
      </p>
      {locations.length > 0 ? (
        <ul className={styles.contactBlockLocations}>
          {locations.map((location) => (
            <li key={location.name}>
              <strong>{location.name}</strong> — {location.address}
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
