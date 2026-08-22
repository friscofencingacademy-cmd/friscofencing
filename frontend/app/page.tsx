'use client';

import Link from 'next/link';

import type { Role } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import { useLoadState } from '../lib/hooks/useLoadState';
import { fetchPublicLevels, fetchPublicLocations } from '../lib/services/catalog';
import { fetchPublicSpotlights } from '../lib/services/spotlights';
import AppShell from './components/layout/AppShell';
import Button from './components/ui/Button/Button';
import Card from './components/ui/Card/Card';
import Hero from './components/marketing/Hero';
import StepsRow from './components/marketing/StepsRow';
import LevelGrid from './components/marketing/LevelGrid';
import CtaBand from './components/marketing/CtaBand';
import SpotlightCard from './components/marketing/SpotlightCard';
import styles from './components/ui/shared.module.css';

interface HomeCard {
  href: string;
  title: string;
  description: string;
}

const HOME_CARDS_BY_ROLE: Record<Role, HomeCard[]> = {
  admin: [
    { href: '/admin/dashboard', title: 'Admin Dashboard', description: 'Manage classes, schedules, pricing, and locations.' },
  ],
  superadmin: [
    { href: '/admin/dashboard', title: 'Admin Dashboard', description: 'Manage classes, schedules, pricing, and locations.' },
  ],
  coach: [
    { href: '/coach/schedules', title: 'My Schedules', description: 'View your upcoming classes.' },
  ],
  parent: [
    { href: '/parent/dashboard', title: 'Parent Dashboard', description: 'Manage your children, trials, registrations, and billing.' },
  ],
  student: [],
};

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
  // No error/isLoading handling surfaced here on purpose — a marketing
  // page must not show a LoadError to a stranger. A section with no data
  // just doesn't render (see docs/features/public-site.md).
  const { data } = useLoadState(fetchHomePageData, []);

  if (loading) {
    return (
      <main style={{ padding: 'var(--space-5)' }}>
        <p>Loading...</p>
      </main>
    );
  }

  if (!user) {
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
          <SpotlightCard
            spotlight={featuredStudent}
            align="right"
            eyebrow="Student Spotlight"
          />
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
            <p style={{ margin: 0 }}>
              {locations.map((location) => location.address).join(' · ')}
            </p>
          ) : null}
          <p style={{ margin: 0 }}>&copy; 2026 Frisco Fencing Academy</p>
        </footer>
      </AppShell>
    );
  }

  const cards = HOME_CARDS_BY_ROLE[user.role] ?? [];

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Welcome, {user.firstName}</h1>
        <p className={styles.pageSubtitle}>Here&apos;s where you can pick up.</p>
      </div>

      {cards.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {cards.map((card) => (
            <Card key={card.href}>
              <h3>{card.title}</h3>
              <p className={styles.pageSubtitle}>{card.description}</p>
              <Button as="a" href={card.href} size="sm">
                Go
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
