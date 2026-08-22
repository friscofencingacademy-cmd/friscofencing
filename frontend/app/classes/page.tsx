'use client';

import { useMemo, useState } from 'react';

import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicSchedules } from '../../lib/services/scheduling';
import { fetchPublicLocations } from '../../lib/services/catalog';
import AppShell from '../components/layout/AppShell';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import ScheduleTable from '../components/marketing/ScheduleTable';
import styles from '../components/ui/shared.module.css';

async function fetchClassesPageData() {
  const [schedules, locations] = await Promise.all([
    fetchPublicSchedules(),
    fetchPublicLocations(),
  ]);
  return { schedules, locations };
}

export default function ClassesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchClassesPageData, []);
  const [levelFilter, setLevelFilter] = useState('');

  const schedules = data?.schedules ?? [];
  const timezone = data?.locations[0]?.timezone;

  const levelOptions = useMemo(
    () => Array.from(new Set(schedules.map((schedule) => schedule.levelName))).sort(),
    [schedules]
  );

  const filteredSchedules = levelFilter
    ? schedules.filter((schedule) => schedule.levelName === levelFilter)
    : schedules;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Class Schedule</h1>
        <p className={styles.pageSubtitle}>
          {timezone ? `All times shown in ${timezone}.` : 'Find a class and book a free trial.'}
        </p>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading ? (
        <p>Loading…</p>
      ) : schedules.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No classes are scheduled right now.</p>
          <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-muted)' }}>
            Questions? Contact us and we&apos;ll help you find a class.
          </p>
        </Card>
      ) : (
        <>
          <div className={styles.formField} style={{ maxWidth: 240 }}>
            <label className={styles.formLabel} htmlFor="level-filter">
              Level
            </label>
            <select
              id="level-filter"
              className={styles.formSelect}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="">All levels</option>
              {levelOptions.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          {filteredSchedules.length === 0 ? (
            <Card>
              <p style={{ margin: 0 }}>No classes match this level.</p>
            </Card>
          ) : (
            <ScheduleTable schedules={filteredSchedules} />
          )}
        </>
      )}
    </AppShell>
  );
}
