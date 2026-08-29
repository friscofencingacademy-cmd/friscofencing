'use client';

import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicSpotlights } from '../../lib/services/spotlights';
import { fetchPublicLocations } from '../../lib/services/catalog';
import AppShell from '../components/layout/AppShell';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import SpotlightCard from '../components/marketing/SpotlightCard';
import SiteFooter from '../components/marketing/SiteFooter';
import styles from '../components/ui/shared.module.css';

async function fetchCoachesPageData() {
  const [coaches, locations] = await Promise.all([
    fetchPublicSpotlights('coach'),
    fetchPublicLocations(),
  ]);
  return { coaches, locations };
}

export default function CoachesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchCoachesPageData, []);

  const coaches = data?.coaches ?? [];

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Coaching Staff</h1>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading ? (
        <p>Loading…</p>
      ) : coaches.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No coach profiles are published yet.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {coaches.map((coach, index) => (
            <SpotlightCard
              key={coach.name}
              spotlight={coach}
              align={index % 2 === 0 ? 'left' : 'right'}
            />
          ))}
        </div>
      )}

      <SiteFooter locations={data?.locations ?? []} />
    </AppShell>
  );
}
