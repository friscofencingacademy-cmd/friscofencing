'use client';

import { useEffect, useId, useState } from 'react';

import {
  addMonths,
  canGoNext,
  canGoPrevious,
  dayString,
  formatDayHeading,
  formatMonthTitle,
  isInMonth,
  monthKey,
  monthOf,
  type CalendarViewMode,
  type CalendarViewState,
} from '../../../lib/calendarView';
import { getErrorMessage } from '../../../lib/hooks/useLoadState';
import type { CalendarDay } from '../../../lib/formatDate';
import type { CalendarEvent, CalendarEventType, CalendarResponse } from '../../../lib/types';
import Button from '../ui/Button/Button';
import LoadError from '../ui/LoadError/LoadError';
import AgendaList, { agendaDayId } from './AgendaList';
import MonthGrid from './MonthGrid';
import styles from './CalendarView.module.css';

// The one calendar (docs/plans/calendar-view-plan.md §2.3): a month grid or,
// on a phone, a day-by-day list; previous / today / next; coach and type
// filters. Controlled — the page owns the state (in the URL) and the data
// (from the backend, which already placed every event on its day).

export interface CalendarViewProps {
  state: CalendarViewState;
  onStateChange: (next: CalendarViewState) => void;
  today: CalendarDay;
  data: CalendarResponse | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  eventHref: (event: CalendarEvent) => string | null;
  typeOptions?: CalendarEventType[];
}

const TYPE_LABELS: Record<CalendarEventType, string> = {
  all: 'Everything',
  group: 'Classes',
  private: 'Private lessons',
};

const VIEW_LABELS: Record<CalendarViewMode, string> = {
  month: 'Month',
  agenda: 'List',
};

// Mirrors the portal shell's own phone breakpoint (docs/design-system.md).
const NARROW_QUERY = '(max-width: 768px)';

// false on the server and on first render, so the first client render always
// matches; the real width is read after mount.
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
}

function emptyMessage(state: CalendarViewState, horizonTo: string | null): string {
  if (horizonTo && `${monthKey(state.month)}-01` > horizonTo) {
    return `Booking is open through ${formatDayHeading(horizonTo)}.`;
  }
  return 'Nothing scheduled this month.';
}

export default function CalendarView({
  state,
  onStateChange,
  today,
  data,
  isLoading,
  error,
  onRetry,
  eventHref,
  typeOptions = ['all', 'group', 'private'],
}: CalendarViewProps) {
  const narrow = useIsNarrow();
  const view: CalendarViewMode = state.view ?? (narrow ? 'agenda' : 'month');
  const coachSelectId = useId();
  const [focusDay, setFocusDay] = useState<string | null>(null);

  // "+N more" switches to the list; once it renders, move focus to that day.
  useEffect(() => {
    if (view !== 'agenda' || !focusDay) return;
    const heading = document.getElementById(agendaDayId(focusDay));
    if (heading) {
      heading.focus();
      if (typeof heading.scrollIntoView === 'function') heading.scrollIntoView({ block: 'start' });
    }
    setFocusDay(null);
  }, [view, focusDay, data]);

  // While loading, `data` is null and the limits are unknown — the buttons
  // stay usable; the backend clips any range past the horizon anyway.
  const horizonTo = data ? data.horizonTo : null;
  const limitsKnown = data !== null;
  const nextAllowed = !limitsKnown || canGoNext(state.month, horizonTo);
  const previousAllowed = !limitsKnown || canGoPrevious(state.month, today, horizonTo);

  const monthEvents = data ? data.events.filter((event) => isInMonth(event.day, state.month)) : [];
  const coaches = data ? data.coaches : [];

  function change(patch: Partial<CalendarViewState>) {
    onStateChange({ ...state, ...patch });
  }

  function showDay(day: string) {
    setFocusDay(day);
    change({ view: 'agenda' });
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.toolbar}>
        <div className={styles.monthNav}>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous month"
            disabled={!previousAllowed}
            onClick={() => change({ month: addMonths(state.month, -1) })}
          >
            ‹
          </Button>
          <Button variant="ghost" size="sm" onClick={() => change({ month: monthOf(today) })}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next month"
            disabled={!nextAllowed}
            onClick={() => change({ month: addMonths(state.month, 1) })}
          >
            ›
          </Button>
          <h2 className={styles.monthTitle} aria-live="polite">
            {formatMonthTitle(state.month)}
          </h2>
        </div>

        <div className={styles.filters}>
          <div className={styles.coachFilter}>
            <label className={styles.filterLabel} htmlFor={coachSelectId}>
              Coach
            </label>
            <select
              id={coachSelectId}
              className={styles.select}
              value={state.coachId ?? ''}
              onChange={(e) => change({ coachId: e.target.value || null })}
            >
              <option value="">All coaches</option>
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.name}
                </option>
              ))}
              {/* A coach from a shared link who has nothing this month stays selectable. */}
              {state.coachId && !coaches.some((coach) => coach.id === state.coachId) ? (
                <option value={state.coachId}>Selected coach</option>
              ) : null}
            </select>
          </div>

          {typeOptions.length > 1 ? (
            <div className={styles.pillRow} role="radiogroup" aria-label="Show">
              {typeOptions.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={state.type === type}
                  className={`${styles.pill} ${state.type === type ? styles.pillSelected : ''}`}
                  onClick={() => change({ type })}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.pillRow} role="radiogroup" aria-label="View">
            {(['month', 'agenda'] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={view === mode}
                className={`${styles.pill} ${view === mode ? styles.pillSelected : ''}`}
                onClick={() => change({ view: mode })}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={onRetry} />
      ) : isLoading || !data ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          {monthEvents.length === 0 ? (
            <p className={styles.empty} role="status">
              {emptyMessage(state, horizonTo)}
            </p>
          ) : null}
          {view === 'month' ? (
            <MonthGrid
              month={state.month}
              today={dayString(today)}
              events={data.events}
              eventHref={eventHref}
              onShowDay={showDay}
            />
          ) : monthEvents.length > 0 ? (
            <AgendaList events={monthEvents} eventHref={eventHref} />
          ) : null}
        </>
      )}
    </div>
  );
}
