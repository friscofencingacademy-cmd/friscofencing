'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from './context/AuthContext';
import { useLoadState } from '../lib/hooks/useLoadState';
import { fetchPublicLevels, fetchPublicLocations } from '../lib/services/catalog';
import { fetchPublicSpotlights } from '../lib/services/spotlights';
import { ROLE_LANDING_PATH } from '../lib/constants';
import AppShell from './components/layout/AppShell';
import Hero from './components/marketing/Hero';
import StepsRow from './components/marketing/StepsRow';
import LevelGrid from './components/marketing/LevelGrid';
import CtaBand from './components/marketing/CtaBand';
import SpotlightCard from './components/marketing/SpotlightCard';

async function fetchHomePageData() {
  const [levels, locations, coachSpotlights, studentSpotlights] = await Promise.all([
    fetchPublicLevels(),
    fetchPublicLocations(),
    fetchPublicSpotlights('coach'),
    fetchPublicSpotlights('student'),
  ]);
  return { levels, locations, coachSpotlights, studentSpotlights };
}

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // No error/isLoading handling surfaced here on purpose — a marketing
  // page must not show a LoadError to a stranger. A section with no data
  // just doesn't render (see docs/features/public-site.md).
  const { data } = useLoadState(fetchHomePageData, []);

  // A signed-in visitor whose role has a dedicated dashboard is bounced
  // straight there — no interim "Welcome" + single-card screen. `student`
  // has no dashboard of its own (deferred, see CLAUDE.md) and is the one
  // role ROLE_LANDING_PATH points back at "/", so it falls through and
  // sees the same public page a logged-out visitor does.
  const shouldRedirect = !!user && ROLE_LANDING_PATH[user.role] !== '/';

  useEffect(() => {
    if (!loading && user && shouldRedirect) {
      router.replace(ROLE_LANDING_PATH[user.role]);
    }
  }, [loading, user, shouldRedirect, router]);

  if (loading || shouldRedirect) {
    return (
      <main style={{ padding: 'var(--space-5)' }}>
        <p>Loading...</p>
      </main>
    );
  }

  const levels = data?.levels ?? [];
  const locations = data?.locations ?? [];
  const headCoach = data?.coachSpotlights[0];
  const featuredStudent = data?.studentSpotlights[0];

  return (
    <AppShell>
      <Hero />

      {headCoach ? (
        <>
          <SpotlightCard spotlight={headCoach} align="left" />
          <p style={{ textAlign: 'center', marginTop: 'calc(-1 * var(--space-4))' }}>
            <Link href="/coaches">View all coaches &rarr;</Link>
          </p>
        </>
      ) : null}

      {featuredStudent ? (
        <SpotlightCard spotlight={featuredStudent} align="right" eyebrow="Student Spotlight" />
      ) : null}

      <StepsRow />
      {levels.length > 0 ? <LevelGrid levels={levels} /> : null}
      <CtaBand />

      <footer
        style={{
          textAlign: 'center',
          padding: 'var(--space-5) 0',
          color: 'var(--color-muted)',
          fontSize: '14px',
        }}
      >
        <p style={{ margin: 0 }}>Frisco Fencing Academy</p>
        {locations.length > 0 ? (
          <p style={{ margin: 0 }}>{locations.map((location) => location.address).join(' · ')}</p>
        ) : null}
        <p style={{ margin: 0 }}>&copy; 2026 Frisco Fencing Academy</p>
      </footer>
    </AppShell>
  );
}
