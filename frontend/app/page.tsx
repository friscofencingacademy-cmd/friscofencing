'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from './context/AuthContext';
import { useLoadState } from '../lib/hooks/useLoadState';
import { fetchPublicLevels, fetchPublicLocations } from '../lib/services/catalog';
import { fetchPublicSpotlights } from '../lib/services/spotlights';
import { ROLE_LANDING_PATH } from '../lib/constants';
import AppShell from './components/layout/AppShell';
import Hero from './components/marketing/Hero';
import ValuesMarquee from './components/marketing/ValuesMarquee';
import IntroSection from './components/marketing/IntroSection';
import StepsRow from './components/marketing/StepsRow';
import LevelGrid from './components/marketing/LevelGrid';
import FacilityBand from './components/marketing/FacilityBand';
import TeamBand from './components/marketing/TeamBand';
import CtaBand from './components/marketing/CtaBand';
import SiteFooter from './components/marketing/SiteFooter';
import SpotlightCard from './components/marketing/SpotlightCard';

// Verbatim from the live WP site's two value-word marquees, captured
// 2026-08-29 (docs/plans/wordpress-ui-alignment-plan.md, Phase 2).
const VALUES_ROW_1 = ['Discipline.', 'Purpose.', 'Guidance.', 'Focus.', 'Confidence.', 'Growth.'];
const VALUES_ROW_2 = ['Accountability.', 'Integrity.', 'Teamwork.', 'Respect.', 'Spirit.', 'Self Belief.'];

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
  const coachSpotlights = data?.coachSpotlights ?? [];
  const featuredStudent = data?.studentSpotlights[0];

  return (
    <AppShell>
      <Hero />
      <ValuesMarquee words={VALUES_ROW_1} />
      <IntroSection />
      {levels.length > 0 ? <LevelGrid levels={levels} /> : null}
      <FacilityBand />
      <TeamBand coaches={coachSpotlights} />
      <ValuesMarquee words={VALUES_ROW_2} />

      {featuredStudent ? (
        <SpotlightCard spotlight={featuredStudent} align="right" eyebrow="Student Spotlight" />
      ) : null}

      <StepsRow />
      <CtaBand />
      <SiteFooter locations={locations} />
    </AppShell>
  );
}
