'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { fetchMyStudents, fetchMySubscriptions, fetchMyTrialClasses } from '../../lib/services/parent';
import { fetchMyPrivateEnrollments } from '../../lib/services/privateClass';
import type { MyPrivateEnrollmentEntry, Student, Subscription, TrialClass } from '../../lib/types';

interface ParentPortalContextValue {
  students: Student[];
  subscriptions: Subscription[];
  trialClasses: TrialClass[];
  privateEnrollments: MyPrivateEnrollmentEntry[];
  loading: boolean;
  error: unknown;
  reload: () => void;
}

const ParentPortalContext = createContext<ParentPortalContextValue | undefined>(undefined);

export function ParentPortalProvider({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [trialClasses, setTrialClasses] = useState<TrialClass[]>([]);
  const [privateEnrollments, setPrivateEnrollments] = useState<MyPrivateEnrollmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // Promise.allSettled, not Promise.all: the household's children
      // (the PRIMARY fetch) must render even if billing/trial/private-class
      // data is temporarily unavailable, and vice versa — an empty
      // household is NOT an error, only a failed students fetch is.
      const [studentsResult, subscriptionsResult, trialClassesResult, privateEnrollmentsResult] =
        await Promise.allSettled([
          fetchMyStudents(),
          fetchMySubscriptions(),
          fetchMyTrialClasses(),
          fetchMyPrivateEnrollments(),
        ]);

      if (cancelled) return;

      if (studentsResult.status === 'fulfilled') {
        setStudents(studentsResult.value);
      } else {
        setStudents([]);
        setError(studentsResult.reason);
      }

      setSubscriptions(subscriptionsResult.status === 'fulfilled' ? subscriptionsResult.value : []);
      setTrialClasses(trialClassesResult.status === 'fulfilled' ? trialClassesResult.value : []);
      setPrivateEnrollments(
        privateEnrollmentsResult.status === 'fulfilled' ? privateEnrollmentsResult.value : []
      );

      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  return (
    <ParentPortalContext.Provider
      value={{ students, subscriptions, trialClasses, privateEnrollments, loading, error, reload }}
    >
      {children}
    </ParentPortalContext.Provider>
  );
}

export function useParentPortal(): ParentPortalContextValue {
  const context = useContext(ParentPortalContext);

  if (context === undefined) {
    throw new Error('useParentPortal must be used within a ParentPortalProvider');
  }

  return context;
}
