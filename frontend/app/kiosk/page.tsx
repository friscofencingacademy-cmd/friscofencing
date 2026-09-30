'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { CheckCircle2 } from 'lucide-react';

import { getErrorMessage } from '../../lib/hooks/useLoadState';
import { fetchKioskState, kioskSignIn } from '../../lib/services/kiosk';
import { formatTime } from '../../lib/formatTime';
import { MIN_SEARCH_LENGTH, POLL_INTERVAL_MS, SUCCESS_DISMISS_MS } from '../../lib/kiosk';
import type { KioskDirectoryEntry, KioskSignInResult, KioskState } from '../../lib/types';
import ProtectedRoute from '../components/ProtectedRoute';
import Alert from '../components/ui/Alert/Alert';
import Button from '../components/ui/Button/Button';
import LoadError from '../components/ui/LoadError/LoadError';
import styles from './kiosk.module.css';

// The front-desk sign-in tablet (docs/plans/kiosk-signin-plan.md K7). Logged
// in as the `kiosk` account (or an admin); chrome-less — no AppShell, no nav,
// no logout button (a student shouldn't sign the tablet out).
//
// search → confirm (skipped when the setting is off) → signingIn → success →
// back to search after SUCCESS_DISMISS_MS or a tap. The server decides which
// class the student is signed in to; this page only sends a studentId.

type Phase = 'loading' | 'search' | 'confirm' | 'signingIn' | 'success';

function matches(entry: KioskDirectoryEntry, query: string): boolean {
  return entry.firstName.toLowerCase().startsWith(query) || entry.lastName.toLowerCase().startsWith(query);
}

export default function KioskPage() {
  return (
    <ProtectedRoute allowedRoles={['kiosk', 'admin', 'superadmin']}>
      <KioskContent />
    </ProtectedRoute>
  );
}

function KioskContent() {
  // Held in a ref so loadState is created once: the load/poll effects depend
  // on loadState, and must never re-run just because a render produced a new
  // router object.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const [phase, setPhase] = useState<Phase>('loading');
  const [kioskState, setKioskState] = useState<KioskState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<KioskDirectoryEntry | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [result, setResult] = useState<KioskSignInResult | null>(null);

  // A failed background poll keeps the list the tablet already has; only a
  // failed FIRST load shows LoadError. An expired login (401) goes to login.
  const loadState = useCallback(async () => {
    try {
      const data = await fetchKioskState();
      setKioskState(data);
      setLoadError(null);
      setPhase((prev) => (prev === 'loading' ? 'search' : prev));
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        routerRef.current.push('/login?next=/kiosk');
        return;
      }
      setLoadError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Refresh while idle on the search screen: every POLL_INTERVAL_MS, and
  // whenever the tablet wakes (new registrations, a flipped setting).
  useEffect(() => {
    if (phase !== 'search') return undefined;

    const interval = setInterval(loadState, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadState();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, loadState]);

  const backToSearch = useCallback(() => {
    setResult(null);
    setTarget(null);
    setSearch('');
    setPhase('search');
  }, []);

  useEffect(() => {
    if (phase !== 'success') return undefined;

    const timer = setTimeout(backToSearch, SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase, backToSearch]);

  async function signIn(entry: KioskDirectoryEntry) {
    setPhase('signingIn');
    const res = await kioskSignIn(entry.studentId);

    if (res.status === 'error') {
      setSignInError(res.message);
      setTarget(null);
      setPhase('search');
      return;
    }

    setResult(res.data);
    setPhase('success');
  }

  function choose(entry: KioskDirectoryEntry) {
    setSignInError(null);

    if (kioskState?.confirmationRequired) {
      setTarget(entry);
      setPhase('confirm');
      return;
    }

    signIn(entry);
  }

  if (phase === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          {loadError ? (
            <LoadError
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                loadState();
              }}
            />
          ) : (
            <p className={styles.muted}>Loading…</p>
          )}
        </div>
      </main>
    );
  }

  if (phase === 'confirm' && target) {
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="kiosk-confirm-title">
          <h2 id="kiosk-confirm-title" className={styles.title}>
            Are you <strong>{`${target.firstName} ${target.lastName}`}</strong>?
          </h2>
          <div className={styles.actions}>
            <Button variant="secondary" size="lg" onClick={() => setPhase('search')}>
              Not me
            </Button>
            <Button size="lg" onClick={() => signIn(target)}>
              Yes, that&apos;s me
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === 'signingIn') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p className={styles.muted}>Signing in…</p>
        </div>
      </main>
    );
  }

  if (phase === 'success' && result) {
    const { student, session, alreadySignedIn } = result;

    return (
      <main className={styles.page}>
        <button type="button" className={`${styles.card} ${styles.success}`} onClick={backToSearch}>
          <CheckCircle2 className={styles.successIcon} size={64} aria-hidden="true" />
          <h2 className={styles.title} role="status">
            {alreadySignedIn
              ? `${student.firstName}, you're already signed in for today.`
              : `${student.firstName} ${student.lastName} signed in`}
          </h2>
          <p className={styles.muted}>
            {session.className ? `${session.className} · ` : ''}
            {formatTime(session.startTime)}–{formatTime(session.endTime)}
          </p>
        </button>
      </main>
    );
  }

  const query = search.trim().toLowerCase();
  const students = kioskState?.students ?? [];
  const searching = query.length >= MIN_SEARCH_LENGTH;
  const found = searching ? students.filter((entry) => matches(entry, query)) : [];

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Image src="/marketing/logo.svg" alt="Frisco Fencing Academy" width={80} height={64} priority />
        <h1 className={styles.title}>Sign In</h1>

        {signInError ? <Alert variant="error">{signInError}</Alert> : null}

        <input
          className={styles.search}
          placeholder="Type your name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSignInError(null);
          }}
          autoFocus
          autoComplete="off"
          aria-label="Search your name"
          data-testid="roster-search"
        />

        {students.length === 0 ? (
          <p className={styles.muted}>No students are enrolled yet.</p>
        ) : !searching ? (
          <p className={styles.muted}>Type your name to sign in.</p>
        ) : found.length === 0 ? (
          <p className={styles.muted}>No matching names.</p>
        ) : (
          <ul className={styles.list}>
            {found.map((entry) => (
              <li key={entry.studentId}>
                <button type="button" className={styles.row} onClick={() => choose(entry)} data-testid="roster-row">
                  <span className={styles.rowName}>
                    {entry.firstName} {entry.lastName}
                  </span>
                  {entry.levelName ? <span className={styles.rowLevel}>{entry.levelName}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
