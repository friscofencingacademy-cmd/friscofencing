'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '../context/AuthContext';
import { useLoadState } from '../../lib/hooks/useLoadState';
import { fetchPublicCalendar } from '../../lib/services/calendar';
import { todayInAcademyTZ } from '../../lib/formatDate';
import {
  bookingHref,
  calendarQueryString,
  monthRange,
  parseCalendarQuery,
  type CalendarViewState,
} from '../../lib/calendarView';
import AppShell from '../components/layout/AppShell';
import CalendarView from '../components/calendar/CalendarView';
import styles from '../components/ui/shared.module.css';

// The public calendar (docs/plans/calendar-view-plan.md §2.4): every upcoming
// class and open private-lesson slot, day by day, filterable by coach. A
// utility page like /classes, so a failed load shows LoadError normally.
//
// useSearchParams() requires a Suspense boundary above it during static
// generation (https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}

function CalendarPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isLoggedInParent = !!user && user.role === 'parent';

  // "Today" in Central, read once per page view.
  const today = useMemo(() => todayInAcademyTZ(), []);
  const state = parseCalendarQuery(searchParams, today);
  const { from, to } = monthRange(state.month);

  const { data, error, isLoading, retry } = useLoadState(
    () => fetchPublicCalendar({ from, to, coachId: state.coachId, type: state.type }),
    [from, to, state.coachId, state.type]
  );

  function handleStateChange(next: CalendarViewState) {
    router.replace(`/calendar${calendarQueryString(next)}`, { scroll: false });
  }

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Calendar</h1>
        <p className={styles.pageSubtitle}>
          Classes and open private lessons, day by day. Pick a coach to see their times. All times Central.
        </p>
      </div>

      <CalendarView
        state={state}
        onStateChange={handleStateChange}
        today={today}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={retry}
        eventHref={(event) => bookingHref(event, isLoggedInParent)}
      />
    </AppShell>
  );
}
