import type { PublicSpotlight } from '../../../lib/types';
import styles from './marketing.module.css';

interface SpotlightCardProps {
  spotlight: PublicSpotlight;
  /** Which side the photo renders on. */
  align: 'left' | 'right';
  /** Optional gold eyebrow label, e.g. "Student Spotlight". */
  eyebrow?: string;
}

// Renders exactly: photo, name, title line, body paragraph, and up to 3
// bullets — all verbatim strings from the response. No field is invented
// or defaulted with placeholder copy; an absent optional field (title,
// body, imageUrl) just doesn't render its line.
export default function SpotlightCard({ spotlight, align, eyebrow }: SpotlightCardProps) {
  const photo = (
    <div
      className={styles.photoPlaceholder}
      role="img"
      aria-label={spotlight.imageUrl ? spotlight.name : `Photo of ${spotlight.name} — coming soon`}
      style={
        spotlight.imageUrl
          ? {
              backgroundImage: `url(${spotlight.imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {spotlight.imageUrl ? null : `Photo of ${spotlight.name} — coming soon`}
    </div>
  );

  const text = (
    <div>
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <h2 className={styles.sectionTitle}>{spotlight.name}</h2>
      {spotlight.title ? <p className={styles.spotlightTitle}>{spotlight.title}</p> : null}
      {spotlight.body ? <p style={{ color: 'var(--color-muted)' }}>{spotlight.body}</p> : null}
      {spotlight.bullets.length > 0 ? (
        <ul className={styles.spotlightBullets}>
          {spotlight.bullets.slice(0, 3).map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  return (
    <section className={styles.twoColGrid}>
      {align === 'left' ? photo : text}
      {align === 'left' ? text : photo}
    </section>
  );
}
