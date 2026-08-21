'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

import { useAuth, type Role } from '../../context/AuthContext';
import Button from '../ui/Button/Button';
import styles from './AppShell.module.css';

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS_BY_ROLE: Record<Role, NavLink[]> = {
  // Admins/superadmins now use the dedicated dark sidebar shell
  // (app/admin/layout.tsx) — AppShell's top bar is no longer part of their
  // authenticated experience. See docs/plans/ckq-ui-adoption-plan.md Phase 1.
  admin: [],
  superadmin: [],
  coach: [{ href: '/coach/schedules', label: 'My Schedules' }],
  parent: [
    { href: '/parent/children', label: 'My Children' },
    { href: '/parent/book-trial', label: 'Book Trial' },
    { href: '/parent/register', label: 'Register' },
    { href: '/parent/subscriptions', label: 'My Subscriptions' },
    { href: '/parent/payment-method', label: 'Payment Method' },
  ],
  student: [],
};

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <div>
        <nav className={styles.nav}>
          <Link href="/" className={styles.wordmark}>
            FRISCO FENCING
            <span className={styles.wordmarkDot} aria-hidden="true" />
          </Link>
        </nav>
        <div className={styles.content}>{children}</div>
      </div>
    );
  }

  const navLinks = NAV_LINKS_BY_ROLE[user.role] ?? [];

  return (
    <div>
      <nav className={styles.nav}>
        <Link href="/" className={styles.wordmark}>
          FRISCO FENCING
          <span className={styles.wordmarkDot} aria-hidden="true" />
        </Link>

        <ul className={styles.navLinks}>
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={styles.navLink}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.userArea}>
          <span className={styles.welcome}>Welcome, {user.firstName}</span>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </nav>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
