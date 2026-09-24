'use client';

import Link from 'next/link';

import { useAuth } from '../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicPrivateLessons } from '../../lib/services/privateClass';
import { formatMoney } from '../../lib/formatMoney';
import { formatRuleRange, formatRuleSlot, sessionCount } from '../../lib/privateLessons';
import type { PrivatePackageOffer, PublicPrivateClassSlot } from '../../lib/types';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import styles from '../components/ui/shared.module.css';

// "Save with a pack: 10 sessions, 10% off" — the academy's configured packs
// (a single session is always offered and needs no mention here).
function packsLine(offers: PrivatePackageOffer[]): string | null {
  const packs = offers.filter((offer) => offer.quantity > 1);
  if (packs.length === 0) return null;
  return `Save with a pack: ${packs
    .map((offer) => `${sessionCount(offer.quantity)}, ${offer.discountPercent}% off`)
    .join(' · ')}`;
}

function SlotRow({ slot, isLoggedInParent }: { slot: PublicPrivateClassSlot; isLoggedInParent: boolean }) {
  // A logged-in parent goes straight to the booking wizard; anyone else goes
  // to log in first, carrying ?next= back to this exact slot.
  const bookingHref = `/parent/register-private?slot=${slot.scheduleId}`;
  const href = isLoggedInParent ? bookingHref : `/login?next=${encodeURIComponent(bookingHref)}`;

  return (
    <div className={styles.scheduleRow}>
      <div>
        <div className={styles.scheduleRowTitle}>{formatRuleSlot(slot)}</div>
        <div className={styles.pageSubtitle}>
          {formatMoney(slot.sessionPrice)} / session · Open {formatRuleRange(slot)}
        </div>
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
  const packs = data ? packsLine(data.packageOffers) : null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Private Lessons</h1>
        <p className={styles.pageSubtitle}>
          One-on-one coaching. Pick a coach and a time, then book one lesson at a time — pay per lesson or
          buy a pack.
        </p>
        {packs ? <p className={styles.pageSubtitle}>{packs}</p> : null}
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
              <h3 style={{ marginTop: 0 }}>{coach.coachName}</h3>
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
