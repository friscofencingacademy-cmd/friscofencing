'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './portal-shell.module.css';

export interface PortalNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
}

export interface PortalNavGroup {
  label?: string;
  items?: PortalNavItem[];
  /** Custom content rendered in place of `items` (e.g. per-child rows). */
  content?: ReactNode;
}

export interface PortalLayoutProps {
  navGroups: PortalNavGroup[];
  header?: ReactNode;
  bottomNavItems: PortalNavItem[];
  children: ReactNode;
}

/** Longest-href-prefix match, mirroring CKQ's PortalLayout active-key resolution. */
function resolveActiveHref(hrefs: string[], pathname: string): string | null {
  const candidates = hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length);

  return candidates[0] ?? null;
}

export default function PortalLayout({ navGroups, header, bottomNavItems, children }: PortalLayoutProps) {
  const pathname = usePathname();

  const sidebarHrefs = navGroups.flatMap((group) => (group.items ?? []).map((item) => item.href));
  const activeSidebarHref = resolveActiveHref(sidebarHrefs, pathname);

  const bottomHrefs = bottomNavItems.map((item) => item.href);
  const activeBottomHref = resolveActiveHref(bottomHrefs, pathname);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Parent portal navigation">
        {navGroups.map((group, index) => (
          <div key={group.label ?? index} className={styles.navGroup}>
            {group.label ? <span className={styles.navGroupLabel}>{group.label}</span> : null}
            {group.content ??
              (group.items ?? []).map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`${styles.sidebarLink} ${activeSidebarHref === item.href ? styles.sidebarLinkActive : ''}`}
                  aria-current={activeSidebarHref === item.href ? 'page' : undefined}
                >
                  <span className={styles.sidebarIcon}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
          </div>
        ))}
      </aside>

      <div className={styles.rightArea}>
        {header ? <div className={styles.mainHeader}>{header}</div> : null}
        <main className={styles.main}>{children}</main>
      </div>

      <nav className={styles.bottomNav} aria-label="Parent portal bottom navigation">
        {bottomNavItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`${styles.bottomNavItem} ${activeBottomHref === item.href ? styles.bottomNavItemActive : ''}`}
            aria-current={activeBottomHref === item.href ? 'page' : undefined}
          >
            <span className={styles.bottomNavIcon}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
