'use client';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels, fetchLocations } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

interface DashboardCounts {
  classes: number;
  schedules: number;
  locations: number;
  levels: number;
}

async function fetchDashboardCounts(): Promise<DashboardCounts> {
  const [classes, schedules, locations, levels] = await Promise.all([
    fetchGroupClasses(),
    fetchSchedules(),
    fetchLocations(),
    fetchLevels(),
  ]);

  return {
    classes: classes.length,
    schedules: schedules.length,
    locations: locations.length,
    levels: levels.length,
  };
}

export default function AdminDashboardPage() {
  const { data: counts, error, isLoading, retry } = useLoadState(fetchDashboardCounts, []);

  return (
    <main>
      <AdminPageHeader title="Dashboard" />

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.classes}</div>
            <div className={styles.statCardLabel}>Classes</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.schedules}</div>
            <div className={styles.statCardLabel}>Schedules</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.locations}</div>
            <div className={styles.statCardLabel}>Locations</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.levels}</div>
            <div className={styles.statCardLabel}>Levels</div>
          </div>
        </div>
      )}
    </main>
  );
}
