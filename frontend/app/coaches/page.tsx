'use client';

import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicSpotlights } from '../../lib/services/spotlights';
import { fetchPublicLocations } from '../../lib/services/catalog';
import AppShell from '../components/layout/AppShell';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import SiteFooter from '../components/marketing/SiteFooter';
import styles from '../components/marketing/marketing.module.css';

async function fetchCoachesPageData() {
  const [coaches, locations] = await Promise.all([
    fetchPublicSpotlights('coach'),
    fetchPublicLocations(),
  ]);
  return { coaches, locations };
}

// "Our Team" band — reuses the exact navy/circular-photo-card visual
// language TeamBand.tsx already established (2026-08-30). TeamBand itself
// isn't rendered anywhere right now (replaced on the home page by
// TestimonialsSection, a separate feature — family testimonials, not
// coach bios); this page reuses its CSS classes directly rather than the
// component itself, since two of TeamBand's behaviors are wrong for a
// dedicated page: its "View all coaches ->" link (would point at itself)
// and its silent-when-empty return null (a visitor landing on /coaches
// directly deserves a real loading/error/empty state, not nothing — that
// rule is for a secondary home-page teaser, not this page).
//
// Eyebrow/heading/subcopy are the owner's own copy, verbatim from the live
// WP site's "Our Team" section, captured 2026-08-30 (docs/features/
// public-site.md has the full writeup). Real coach data only — every name/
// title/photo traces to a published Spotlight (type: coach); nothing here
// is invented.
export default function CoachesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchCoachesPageData, []);

  const coaches = data?.coaches ?? [];

  return (
    <AppShell>
      <section className={`${styles.teamBand} ${styles.fullBleed}`}>
        <div className={styles.teamBandInner}>
          <span className={styles.eyebrow}>Our Team</span>
          <h1 className={styles.sectionTitle}>Guided by Experience</h1>
          <p className={styles.teamSubcopy}>
            Our coaching and support team brings deep experience, thoughtful leadership, and a
            shared commitment to putting students first on and off the strip.
          </p>

          {error ? (
            // LoadError's default styling (error-red message, ink-bordered
            // retry button) assumes a light page background — floating it
            // in a light card here keeps the real, tested component and
            // its retry() wiring exactly as every other page uses it,
            // rather than inventing a dark-background variant.
            <div
              style={{
                background: 'var(--color-white)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                maxWidth: 480,
                margin: '0 auto',
              }}
            >
              <LoadError message={getErrorMessage(error)} onRetry={retry} />
            </div>
          ) : isLoading ? (
            <p style={{ color: 'rgba(255, 255, 255, 0.75)' }}>Loading…</p>
          ) : coaches.length === 0 ? (
            <Card>
              <p style={{ margin: 0 }}>No coach profiles are published yet.</p>
            </Card>
          ) : (
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
          )}
        </div>
      </section>

      <SiteFooter locations={data?.locations ?? []} />
    </AppShell>
  );
}
