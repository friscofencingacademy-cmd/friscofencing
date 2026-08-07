'use client';

import type { Role } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import Button from './components/ui/Button/Button';
import Card from './components/ui/Card/Card';
import styles from './components/ui/shared.module.css';

interface HomeCard {
  href: string;
  title: string;
  description: string;
}

const HOME_CARDS_BY_ROLE: Record<Role, HomeCard[]> = {
  admin: [
    { href: '/admin/classes', title: 'Manage Classes', description: 'Create and edit class offerings.' },
    { href: '/admin/schedules', title: 'Manage Schedules', description: 'View and adjust class schedules.' },
    { href: '/admin/prices', title: 'Pricing', description: 'Set pricing for classes and packages.' },
  ],
  superadmin: [
    { href: '/admin/classes', title: 'Manage Classes', description: 'Create and edit class offerings.' },
    { href: '/admin/schedules', title: 'Manage Schedules', description: 'View and adjust class schedules.' },
    { href: '/admin/prices', title: 'Pricing', description: 'Set pricing for classes and packages.' },
  ],
  coach: [
    { href: '/coach/schedules', title: 'My Schedules', description: 'View your upcoming classes.' },
  ],
  parent: [
    { href: '/parent/book-trial', title: 'Book a Trial', description: 'Schedule a trial class for your child.' },
    { href: '/parent/register', title: 'Register for a Class', description: 'Enroll your child in a class.' },
    { href: '/parent/subscriptions', title: 'My Subscriptions', description: 'View and manage billing.' },
  ],
  student: [],
};

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main style={{ padding: 'var(--space-5)' }}>
        <p>Loading...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main style={{ padding: 'var(--space-6) var(--space-5)' }}>
        <h1>Frisco Fencing Academy</h1>
        <p className={styles.pageSubtitle}>
          Manage classes, schedules, and registrations for Frisco Fencing Academy.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button as="a" href="/login">
            Log In
          </Button>
          <Button as="a" href="/register" variant="secondary">
            Sign Up
          </Button>
        </div>
      </main>
    );
  }

  const cards = HOME_CARDS_BY_ROLE[user.role] ?? [];

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Welcome, {user.firstName}</h1>
        <p className={styles.pageSubtitle}>Here&apos;s where you can pick up.</p>
      </div>

      {cards.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {cards.map((card) => (
            <Card key={card.href}>
              <h3>{card.title}</h3>
              <p className={styles.pageSubtitle}>{card.description}</p>
              <Button as="a" href={card.href} size="sm">
                Go
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
