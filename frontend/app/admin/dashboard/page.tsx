'use client';

import Link from 'next/link';
import { CalendarDays, DollarSign, GraduationCap, MapPin, Swords } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchGroupClasses, fetchLevels, fetchLocations, fetchPrices } from '../../../lib/services/catalog';
import { fetchSchedules } from '../../../lib/services/scheduling';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

interface DashboardCounts {
  classes: number;
  schedules: number;
  locations: number;
  levels: number;
  prices: number;
}

async function fetchDashboardCounts(): Promise<DashboardCounts> {
  const [classes, schedules, locations, levels, prices] = await Promise.all([
    fetchGroupClasses(),
    fetchSchedules(),
    fetchLocations(),
    fetchLevels(),
    fetchPrices(),
  ]);

  return {
    classes: classes.length,
    schedules: schedules.length,
    locations: locations.length,
    levels: levels.length,
    prices: prices.length,
  };
}

const QUICK_LINKS = [
  { href: '/admin/classes', title: 'Classes', description: 'Manage class offerings', icon: <Swords size={18} /> },
  { href: '/admin/levels', title: 'Levels', description: 'Manage skill levels', icon: <GraduationCap size={18} /> },
  { href: '/admin/prices', title: 'Prices', description: 'Set pricing per level', icon: <DollarSign size={18} /> },
  { href: '/admin/schedules', title: 'Schedules', description: 'View and add class schedules', icon: <CalendarDays size={18} /> },
  { href: '/admin/locations', title: 'Locations', description: 'Manage academy locations', icon: <MapPin size={18} /> },
];

export default function AdminDashboardPage() {
  const { data: counts, error, isLoading, retry } = useLoadState(fetchDashboardCounts, []);

  return (
    <main>
      <AdminPageHeader title="Dashboard" />

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.classes}</div>
            <div className={styles.statCardLabel}>Classes</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.schedules}</div>
            <div className={styles.statCardLabel}>Schedules</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.locations}</div>
            <div className={styles.statCardLabel}>Locations</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statCardValue}>{isLoading ? '—' : counts?.levels}</div>
            <div className={styles.statCardLabel}>Levels</div>
          </div>
        </div>
      )}

      <div className={styles.quickLinksGrid}>
        {QUICK_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={styles.quickLinkCard}>
            <div className={styles.quickLinkTitle}>
              {link.icon} {link.title}
            </div>
            <p className={styles.quickLinkMeta}>{link.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
