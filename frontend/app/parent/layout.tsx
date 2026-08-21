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

    if (!isAllowed) {
      router.push('/');
    }
  }, [loading, isAllowed, router]);

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
