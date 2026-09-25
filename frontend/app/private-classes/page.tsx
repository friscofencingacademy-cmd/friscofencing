'use client';

import Link from 'next/link';

import { useAuth } from '../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicPrivateLessons } from '../../lib/services/privateClass';
import { formatMoney } from '../../lib/formatMoney';
import { formatRuleRange, formatRuleSlot, packListingLabel } from '../../lib/privateLessons';
import type { PublicPrivateClassSlot } from '../../lib/types';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import styles from '../components/ui/shared.module.css';

// "Packs: 10 lessons for $300.00" — this coach's packs for this slot's length
// (docs/plans/coach-pack-pricing-plan.md), straight from the slot's options.
// The single session is the "/ session" price above and is not repeated.
function packsLine(slot: PublicPrivateClassSlot): string | null {
  const packs = slot.options.filter((option) => option.packId !== null);
  if (packs.length === 0) return null;
  return `Packs: ${packs.map(packListingLabel).join(' · ')}`;
}

function SlotRow({ slot, isLoggedInParent }: { slot: PublicPrivateClassSlot; isLoggedInParent: boolean }) {
  // A logged-in parent goes straight to the booking wizard; anyone else goes
  // to log in first, carrying ?next= back to this exact slot.
  const bookingHref = `/parent/register-private?slot=${slot.scheduleId}`;
  const href = isLoggedInParent ? bookingHref : `/login?next=${encodeURIComponent(bookingHref)}`;
  const packs = packsLine(slot);

  return (
    <div className={styles.scheduleRow}>
      <div>
        <div className={styles.scheduleRowTitle}>{formatRuleSlot(slot)}</div>
        <div className={styles.pageSubtitle}>
          {formatMoney(slot.sessionPrice)} / session · Open {formatRuleRange(slot)}
        </div>
        {packs ? <div className={styles.pageSubtitle}>{packs}</div> : null}
      </div>
      <div className={styles.scheduleRowActions}>
        <Button as="a" href={href} size="sm">
          Pick a date
        </Button>
      </div>
    </div>
  );
}

export default function PrivateClassesPage() {
  // The page is public; a logged-in parent must never see the "register
  // first" prompt (authLoading guards the brief session-restore window).
  const { user, loading: authLoading } = useAuth();
  const isLoggedInParent = !!user && user.role === 'parent';
  const { data, error, isLoading, retry } = useLoadState(fetchPublicPrivateLessons, []);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Private Lessons</h1>
        <p className={styles.pageSubtitle}>
          One-on-one coaching. Pick a coach and a time, then book one lesson at a time — pay per lesson or
          buy a pack.
        </p>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading ? (
        <p>Loading…</p>
      ) : !data || data.coaches.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No private lesson times are open right now — check back soon.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {data.coaches.map((coach) => (
            <Card key={coach.coachId}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--space-2)',
                }}
              >
                <h3 style={{ margin: 0 }}>{coach.coachName}</h3>
                {/* This coach's open dates, day by day (docs/plans/calendar-view-plan.md §2.4). */}
                <Link href={`/calendar?coach=${coach.coachId}&type=private`}>View on calendar</Link>
              </div>
              <div>
                {coach.slots.map((slot) => (
                  <SlotRow key={slot.scheduleId} slot={slot} isLoggedInParent={isLoggedInParent} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!authLoading && !user ? (
        <p style={{ marginTop: 'var(--space-5)', fontSize: '0.9rem', color: 'var(--color-muted)' }}>
          Don&apos;t have an account yet? <Link href="/register">Register</Link> first, then come back to book.
        </p>
      ) : null}
    </AppShell>
  );
}
