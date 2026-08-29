'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useAuth, type Role } from '../../context/AuthContext';
import Button from '../ui/Button/Button';
import styles from './AppShell.module.css';

interface NavLink {
  href: string;
  label: string;
}

// Logged-out (public) nav. Rebranded 2026-08-29 to mirror the live WP
// site's own nav wording (docs/plans/wordpress-ui-alignment-plan.md,
// Phase 2) — "Home" alongside the wordmark (the WP site has both), "Programs"
// for /classes, "Our Team" for /coaches. Every public CTA points at
// /register (no guest booking, see docs/features/public-site.md).
const PUBLIC_NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/classes', label: 'Programs' },
  { href: '/coaches', label: 'Our Team' },
  { href: '/private-classes', label: 'Private Lessons' },
];

const NAV_LINKS_BY_ROLE: Record<Role, NavLink[]> = {
  // Admins/superadmins now use the dedicated dark sidebar shell
  // (app/admin/layout.tsx) — AppShell's top bar is no longer part of their
  // authenticated experience. See docs/plans/ckq-ui-adoption-plan.md Phase 1.
  admin: [],
  superadmin: [],
  coach: [
    { href: '/coach/schedules', label: 'My Schedules' },
    { href: '/coach/private-students', label: 'Private Students' },
  ],
  // Parents now use the dedicated portal shell (app/parent/layout.tsx) —
  // AppShell now serves coach + logged-out visitors only. See
  // docs/plans/ckq-ui-adoption-plan.md Phase 3.
  parent: [],
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
            <Image src="/marketing/logo.svg" alt="Frisco Fencing Academy" width={40} height={32} priority />
          </Link>

          <ul className={styles.navLinks}>
            {PUBLIC_NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={styles.navLink}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className={styles.userArea}>
            <Button as="a" href="/login" variant="ghost" size="sm">
              Log In
            </Button>
            <Button as="a" href="/register" size="sm">
              Take a Trial Class
            </Button>
          </div>
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
          <Image src="/marketing/logo.svg" alt="Frisco Fencing Academy" width={40} height={32} priority />
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
