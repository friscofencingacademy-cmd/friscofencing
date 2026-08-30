'use client';

import { useMemo, useState } from 'react';

import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicSchedules } from '../../lib/services/scheduling';
import { fetchPublicLevels, fetchPublicLocations } from '../../lib/services/catalog';
import type { PublicLevel } from '../../lib/types';
import AppShell from '../components/layout/AppShell';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import ScheduleTable from '../components/marketing/ScheduleTable';
import SiteFooter from '../components/marketing/SiteFooter';
import styles from '../components/ui/shared.module.css';

async function fetchClassesPageData() {
  const [schedules, locations] = await Promise.all([
    fetchPublicSchedules(),
    fetchPublicLocations(),
  ]);

  // Levels feed a progressive-enhancement control (the level filter) — a
  // failure here must never blank the whole page or the schedule table
  // itself, only collapse the filter to "All levels" (docs/plans/frontend-
  // polish-plan.md PR 4's explicit degradation decision).
  let levels: PublicLevel[] = [];
  try {
    levels = await fetchPublicLevels();
  } catch {
    levels = [];
  }

  return { schedules, locations, levels };
}

export default function ClassesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchClassesPageData, []);
  const [levelFilter, setLevelFilter] = useState('');

  const schedules = data?.schedules ?? [];

  // Catalog order (the admin's own Level.order), never alphabetical or
  // derived from whichever rows happened to arrive — a level with zero
  // scheduled sessions still appears in the filter (docs/plans/frontend-
  // polish-plan.md PR 4, finding B4). Filtering the already-loaded
  // schedules below stays client-side; it's the OPTION LIST that must come
  // from the catalog, not the rows.
  const levelOptions = useMemo(
    () => [...(data?.levels ?? [])].sort((a, b) => a.order - b.order).map((level) => level.name),
    [data?.levels]
  );

  // Distinct timezones across every returned row — never guessed from
  // "whichever location loaded first" (finding B2). Exactly one zone keeps
  // the single page-level line below; more than one drops it in favor of a
  // per-row zone in ScheduleTable instead.
  const distinctTimezones = useMemo(
    () => Array.from(new Set(schedules.map((schedule) => schedule.timezone))),
    [schedules]
  );
  const singleTimezone = distinctTimezones.length === 1 ? distinctTimezones[0] : null;

  const filteredSchedules = levelFilter
    ? schedules.filter((schedule) => schedule.levelName === levelFilter)
    : schedules;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Class Schedule</h1>
        <p className={styles.pageSubtitle}>
          {singleTimezone ? `All times shown in ${singleTimezone}.` : 'Find a class and book a free trial.'}
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
          {/* Pill row (>600px) and <select> (<=600px, a pill row wraps
              badly on a phone) drive the exact same levelFilter state. */}
          <div className={styles.levelFilterRow} role="radiogroup" aria-label="Filter by level">
            <button
              type="button"
              role="radio"
              aria-checked={levelFilter === ''}
              className={`${styles.levelFilterPill} ${levelFilter === '' ? styles.levelFilterPillSelected : ''}`}
              onClick={() => setLevelFilter('')}
            >
              All levels
            </button>
            {levelOptions.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={levelFilter === level}
                className={`${styles.levelFilterPill} ${levelFilter === level ? styles.levelFilterPillSelected : ''}`}
                onClick={() => setLevelFilter(level)}
              >
                {level}
              </button>
            ))}
          </div>

          <div className={`${styles.formField} ${styles.levelFilterSelectWrap}`}>
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
            <ScheduleTable schedules={filteredSchedules} showTimezone={!singleTimezone} />
          )}
        </>
      )}

      <SiteFooter locations={data?.locations ?? []} />
    </AppShell>
  );
}
