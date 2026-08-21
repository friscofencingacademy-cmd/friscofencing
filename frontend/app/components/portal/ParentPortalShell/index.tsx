'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CalendarPlus, ClipboardList, CreditCard, Home, LogOut, Swords, Wallet } from 'lucide-react';

import { useAuth } from '../../../context/AuthContext';
import { useParentPortal } from '../../../context/ParentPortalContext';
import { getChildPalette } from '../../../../lib/childPalette';
import type { Student } from '../../../../lib/types';
import PortalLayout, { type PortalNavGroup, type PortalNavItem } from '../PortalLayout';
import AddChildModal from '../AddChildModal';
import styles from './ParentPortalShell.module.css';

const HOME_ITEMS: PortalNavItem[] = [{ key: 'home', label: 'Home', icon: <Home size={18} />, href: '/parent/dashboard' }];

const ACADEMY_ITEMS: PortalNavItem[] = [
  { key: 'book-trial', label: 'Book Trial', icon: <CalendarPlus size={18} />, href: '/parent/book-trial' },
  { key: 'register', label: 'Register', icon: <ClipboardList size={18} />, href: '/parent/register' },
  {
    key: 'private-lessons',
    label: 'Private Lessons',
    icon: <Swords size={18} />,
    href: '/private-classes',
  },
  { key: 'billing', label: 'Billing', icon: <CreditCard size={18} />, href: '/parent/subscriptions' },
  { key: 'payment-method', label: 'Payment Method', icon: <Wallet size={18} />, href: '/parent/payment-method' },
];

const BOTTOM_NAV_ITEMS: PortalNavItem[] = [
  { key: 'home', label: 'Home', icon: <Home size={20} />, href: '/parent/dashboard' },
  { key: 'children', label: 'Children', icon: <ClipboardList size={20} />, href: '/parent/children' },
  { key: 'register', label: 'Register', icon: <CalendarPlus size={20} />, href: '/parent/register' },
  { key: 'billing', label: 'Billing', icon: <CreditCard size={20} />, href: '/parent/subscriptions' },
];

function childStatusLine(hasActiveSubscription: boolean, hasTrial: boolean): string {
  if (hasActiveSubscription) return 'Enrolled';
  if (hasTrial) return 'Trial booked';
  return 'Not enrolled';
}

interface ChildNavRowsProps {
  students: Student[];
  hasActiveSubscription: (studentId: string) => boolean;
  hasTrial: (studentId: string) => boolean;
  onAddChild: () => void;
}

function ChildNavRows({ students, hasActiveSubscription, hasTrial, onAddChild }: ChildNavRowsProps) {
  return (
    <>
      {students.map((student, index) => {
        const palette = getChildPalette(index);
        return (
          <Link key={student._id} href={`/parent/child/${student._id}`} className={styles.childRow}>
            <span className={styles.childAvatar} style={{ background: palette.gradient }} aria-hidden="true">
              {student.firstName[0]?.toUpperCase() ?? '?'}
            </span>
            <span className={styles.childInfo}>
              <span className={styles.childName}>
                {student.firstName} {student.lastName}
              </span>
              <span className={styles.childMeta}>
                {childStatusLine(hasActiveSubscription(student._id), hasTrial(student._id))}
              </span>
            </span>
          </Link>
        );
      })}
      <button type="button" className={styles.addChildRow} onClick={onAddChild}>
        + Add child
      </button>
    </>
  );
}

interface ParentPortalShellProps {
  children: ReactNode;
}

export default function ParentPortalShell({ children }: ParentPortalShellProps) {
  const { user, logout } = useAuth();
  const { students, subscriptions, trialClasses, reload } = useParentPortal();
  const [addChildOpen, setAddChildOpen] = useState(false);

  const hasActiveSubscription = (studentId: string) =>
    subscriptions.some((sub) => sub.studentId._id === studentId && sub.status === 'active');

  const hasTrial = (studentId: string) => trialClasses.some((trial) => trial.studentId._id === studentId);

  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(today);

  const header = (
    <div className={styles.header}>
      <div>
        <p className={styles.headerGreeting}>Welcome back, {user?.firstName}</p>
        <p className={styles.headerDate}>{dateLabel}</p>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.headerChip}>
          {students.length} {students.length === 1 ? 'child' : 'children'}
        </span>
        <button type="button" className={styles.logoutButton} onClick={() => logout()}>
          <LogOut size={14} />
          Log out
        </button>
      </div>
    </div>
  );

  const navGroups: PortalNavGroup[] = [
    { label: 'HOME', items: HOME_ITEMS },
    {
      label: 'CHILDREN',
      content: (
        <ChildNavRows
          students={students}
          hasActiveSubscription={hasActiveSubscription}
          hasTrial={hasTrial}
          onAddChild={() => setAddChildOpen(true)}
        />
      ),
    },
    { label: 'ACADEMY', items: ACADEMY_ITEMS },
  ];

  return (
    <>
      <PortalLayout navGroups={navGroups} header={header} bottomNavItems={BOTTOM_NAV_ITEMS}>
        {children}
      </PortalLayout>

      {addChildOpen ? (
        <AddChildModal
          onClose={() => setAddChildOpen(false)}
          onSuccess={() => {
            setAddChildOpen(false);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
