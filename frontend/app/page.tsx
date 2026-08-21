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
    { href: '/admin/dashboard', title: 'Admin Dashboard', description: 'Manage classes, schedules, pricing, and locations.' },
  ],
  superadmin: [
    { href: '/admin/dashboard', title: 'Admin Dashboard', description: 'Manage classes, schedules, pricing, and locations.' },
  ],
  coach: [
    { href: '/coach/schedules', title: 'My Schedules', description: 'View your upcoming classes.' },
  ],
  parent: [
    { href: '/parent/dashboard', title: 'Parent Dashboard', description: 'Manage your children, trials, registrations, and billing.' },
  ],
  student: [],
};

interface OfferItem {
  title: string;
  description: string;
}

const WHAT_WE_OFFER: OfferItem[] = [
  {
    title: 'Beginner to Advanced',
    description: 'Classes for every skill level, from first touch to competitive fencing.',
  },
  {
    title: 'Expert Coaching',
    description: 'Experienced coaches focused on fundamentals and long-term growth.',
  },
  {
    title: 'Flexible Scheduling',
    description: "Weekly classes that fit your family's schedule.",
  },
];

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
      <AppShell>
        <section style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h1 className={styles.pageTitle}>Frisco Fencing Academy</h1>
          <p style={{ fontSize: '18px', color: 'var(--color-muted)', margin: '0 auto var(--space-5)', maxWidth: 560 }}>
            Expert fencing instruction for all ages and skill levels.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
            <Button as="a" href="/register" size="lg">
              Book a Free Trial
            </Button>
            <Button as="a" href="/login" variant="secondary" size="lg">
              Log In
            </Button>
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
            marginTop: 'var(--space-6)',
          }}
        >
          {WHAT_WE_OFFER.map((item) => (
            <Card key={item.title}>
              <h3>{item.title}</h3>
              <p className={styles.pageSubtitle}>{item.description}</p>
            </Card>
          ))}
        </section>

        <section style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h2 className={styles.pageTitle}>Ready to get started?</h2>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button as="a" href="/register" size="lg">
              Book a Free Trial
            </Button>
          </div>
        </section>

        <footer style={{ textAlign: 'center', padding: 'var(--space-5) 0', color: 'var(--color-muted)', fontSize: '14px' }}>
          &copy; 2026 Frisco Fencing Academy
        </footer>
      </AppShell>
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
