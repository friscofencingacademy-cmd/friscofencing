'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '../context/AuthContext';
import { ParentPortalProvider } from '../context/ParentPortalContext';
import ParentPortalShell from '../components/portal/ParentPortalShell';

interface ParentLayoutProps {
  children: ReactNode;
}

export default function ParentLayout({ children }: ParentLayoutProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isAllowed = !!user && user.role === 'parent';

  useEffect(() => {
    if (loading) {
      return;
    }

    if (isAllowed) {
      return;
    }

    // Not logged in at all (e.g. a parent clicked "Book this slot" on the
    // public /private-classes page without an account) -> send them to log
    // in or register, carrying the page they actually wanted via ?next= —
    // the same param /login and /register already read to bounce back here
    // on success. A logged-in user of the WRONG role (coach/admin/student)
    // is a different case entirely — they don't need to log in again, this
    // area just isn't theirs, so that still goes home.
    if (!user) {
      const destination = `${window.location.pathname}${window.location.search}`;
      router.push(`/login?next=${encodeURIComponent(destination)}`);
      return;
    }

    router.push('/');
  }, [loading, isAllowed, user, router]);

  if (loading) {
    return <div style={{ padding: 'var(--space-5)' }}>Loading…</div>;
  }

  if (!isAllowed) {
    return null;
  }

  return (
    <ParentPortalProvider>
      <ParentPortalShell>{children}</ParentPortalShell>
    </ParentPortalProvider>
  );
}
