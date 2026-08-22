'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays,
  CreditCard,
  DollarSign,
  FileSignature,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MapPin,
  Star,
  Swords,
  Users,
  X,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import styles from './layout.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Standalone, ungrouped items rendered above the collapsible sections
// below — the most-reached-for pages, one click away with no section to
// open first.
const TOP_LEVEL_ITEMS: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { href: '/admin/users', label: 'Users', icon: <Users size={16} /> },
];

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Programs',
    items: [
      { href: '/admin/classes', label: 'Classes', icon: <Swords size={15} /> },
      { href: '/admin/levels', label: 'Levels', icon: <GraduationCap size={15} /> },
      { href: '/admin/schedules', label: 'Schedules', icon: <CalendarDays size={15} /> },
      { href: '/admin/subscriptions', label: 'Subscriptions', icon: <CreditCard size={15} /> },
      { href: '/admin/private-classes', label: 'Private Classes', icon: <Swords size={15} /> },
      { href: '/admin/coach-contracts', label: 'Coach Contracts', icon: <FileSignature size={15} /> },
    ],
  },
  {
    label: 'Billing',
    items: [{ href: '/admin/prices', label: 'Prices', icon: <DollarSign size={15} /> }],
  },
  {
    label: 'Places',
    items: [{ href: '/admin/locations', label: 'Locations', icon: <MapPin size={15} /> }],
  },
  {
    label: 'Content',
    items: [{ href: '/admin/spotlights', label: 'Spotlights', icon: <Star size={15} /> }],
  },
];

function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || (href !== '/admin/dashboard' && pathname.startsWith(href));
}

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAllowed = !!user && (user.role === 'admin' || user.role === 'superadmin');

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAllowed) {
      router.push('/');
    }
  }, [loading, isAllowed, router]);

  // Auto-open the section containing the current route; close the others.
  useEffect(() => {
    const activeSection = NAV_SECTIONS.find((section) =>
      section.items.some((item) => isNavActive(item.href, pathname))
    );

    setOpenSections(activeSection ? { [activeSection.label]: true } : {});
  }, [pathname]);

  if (loading) {
    return <div className={styles.loadingScreen}>Loading…</div>;
  }

  if (!isAllowed) {
    return null;
  }

  const closeMobile = () => setMobileOpen(false);
  const toggleSection = (label: string) =>
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  const sidebarClass = mobileOpen
    ? `${styles.sidebar} ${styles.sidebarMobileOpen}`
    : styles.sidebar;

  return (
    <div className={styles.layout}>
      {/* Mobile top bar */}
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.hamburger}
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <Menu size={22} />
        </button>
        <span className={styles.topBarTitle}>FRISCO FENCING</span>
      </div>

      {/* Mobile overlay */}
      <div
        className={`${styles.overlay} ${mobileOpen ? styles.overlayVisible : ''}`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <nav className={sidebarClass} aria-label="Admin sidebar">
        <div className={styles.brand}>
          <div className={styles.brandTitle}>
            FRISCO FENCING
            <span className={styles.brandDot} aria-hidden="true" />
          </div>
          <button
            type="button"
            className={styles.mobileClose}
            onClick={closeMobile}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className={styles.brandRole}>{user.role}</div>

        <ul className={styles.navList}>
          {TOP_LEVEL_ITEMS.map((item) => {
            const active = isNavActive(item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                  onClick={closeMobile}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.icon}
                  <span className={styles.navLabel}>{item.label}</span>
                </Link>
              </li>
            );
          })}

          {NAV_SECTIONS.map((section) => {
            const isOpen = !!openSections[section.label];
            const hasActive = section.items.some((item) => isNavActive(item.href, pathname));

            return (
              <li key={section.label}>
                <button
                  type="button"
                  className={`${styles.sectionHeader} ${hasActive ? styles.sectionHeaderActive : ''}`}
                  onClick={() => toggleSection(section.label)}
                >
                  <span className={styles.sectionLabel}>{section.label}</span>
                </button>

                <ul className={`${styles.sectionItems} ${isOpen ? styles.sectionItemsOpen : ''}`}>
                  {section.items.map((item) => {
                    const active = isNavActive(item.href, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`${styles.navItem} ${styles.navItemSub} ${active ? styles.navItemActive : ''}`}
                          onClick={closeMobile}
                          aria-current={active ? 'page' : undefined}
                        >
                          {item.icon}
                          <span className={styles.navLabel}>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <div className={styles.sidebarFooter}>
          <span className={styles.sidebarFooterWelcome}>Welcome, {user.firstName}</span>
          <button type="button" className={styles.sidebarFooterLogout} onClick={() => logout()}>
            Log out
          </button>
        </div>
      </nav>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
