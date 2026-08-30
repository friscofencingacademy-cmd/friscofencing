'use client';

import Link from 'next/link';

import { useAuth } from '../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchPublicPrivateClassCoaches } from '../../lib/services/privateClass';
import { formatTime } from '../../lib/formatTime';
import type { PublicPrivateClassSlot } from '../../lib/types';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import LoadError from '../components/ui/LoadError/LoadError';
import styles from '../components/ui/shared.module.css';

function formatFirstSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function SlotRow({ slot, isLoggedInParent }: { slot: PublicPrivateClassSlot; isLoggedInParent: boolean }) {
  // A logged-in parent goes straight to the booking wizard; anyone else
  // (logged out, or logged in as some other role) goes to log in first,
  // carrying ?next= so they land right back on this exact slot afterward —
  // /parent/layout.tsx's own guard would otherwise bounce a logged-out
  // visitor here through a "Loading…" flash before redirecting to the same
  // place. Deliberately not "/register?next=..." (unlike the group-class
  // trial CTA) — /login already offers a "Register" link for someone with
  // no account yet, and doesn't force a re-registration attempt on someone
  // who already has one.
  const bookingHref = `/parent/register-private?slot=${slot.scheduleId}`;
  const href = isLoggedInParent ? bookingHref : `/login?next=${encodeURIComponent(bookingHref)}`;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
        borderTop: '1px solid var(--color-border)',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>
          {slot.dayName} · {formatTime(slot.startTime)} · {slot.durationMinutes} min
        </div>
        <div className={styles.pageSubtitle}>
          ${slot.sessionPrice.toFixed(2)} / session · First session {formatFirstSessionDate(slot.firstSessionDate)}
        </div>
      </div>
      <Button as="a" href={href} size="sm">
        Book this slot
      </Button>
    </div>
  );
}

export default function PrivateClassesPage() {
  // Gates the "don't have an account?" prompt below — this page is public
  // (no auth required to browse), but a parent who's already logged in must
  // never see a prompt telling them to go log in/register. `authLoading` is
  // checked too so the prompt doesn't flash for a real logged-in parent
  // during the brief window before the session restore resolves.
  const { user, loading: authLoading } = useAuth();
  const isLoggedInParent = !!user && user.role === 'parent';
  const { data, error, isLoading, retry } = useLoadState(fetchPublicPrivateClassCoaches, []);

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Private Lessons</h1>
        <p className={styles.pageSubtitle}>
          One-on-one coaching, billed per completed session — no monthly commitment.
        </p>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading ? (
        <p>Loading…</p>
      ) : !data || data.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>No private lesson slots are open right now — check back soon.</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {data.map((coach) => (
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
          Don&apos;t have an account yet? <Link href="/register">Register</Link> first, then come back to
          book a slot.
        </p>
      ) : null}
    </AppShell>
  );
}
