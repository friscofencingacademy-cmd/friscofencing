'use client';

import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicSpotlights } from '../../lib/services/spotlights';
import AppShell from '../components/layout/AppShell';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import SpotlightCard from '../components/marketing/SpotlightCard';
import styles from '../components/ui/shared.module.css';

export default function CoachesPage() {
  const { data, error, isLoading, retry } = useLoadState(
    () => fetchPublicSpotlights('coach'),
    []
  );

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Coaching Staff</h1>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading ? (
        <p>Loading…</p>
      ) : !data || data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No coach profiles are published yet.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
          {data.map((coach, index) => (
            <SpotlightCard
              key={coach.name}
              spotlight={coach}
              align={index % 2 === 0 ? 'left' : 'right'}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
