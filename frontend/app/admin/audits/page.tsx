'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { fetchLatestAuditRuns } from '../../../lib/services/auditRuns';
import type { AuditOverallResult, AuditRun, AuditScenarioResult } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/admin/admin.module.css';

const GENERIC_LOAD_ERROR = "Couldn't load audit results — please try again.";

// Hardcoded on purpose — this is the registry of audit/ scripts documented
// in docs/plans/audit-system-plan.md, not something the backend knows
// about. An audit with no run yet still gets a row ("Never run") so the
// dashboard reads as a checklist, not just a log of what happened to run.
interface KnownAudit {
  key: string;
  label: string;
}

const KNOWN_AUDITS: KnownAudit[] = [
  { key: 'audit-live-registration', label: 'Live Registration' },
];

function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((Date.now() - then) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear} year${diffYear === 1 ? '' : 's'} ago`;
}

const OVERALL_CHIP: Record<AuditOverallResult, { cls: string; icon: string; label: string }> = {
  pass: { cls: styles.chipActive, icon: '✓', label: 'Pass' },
  fail: { cls: styles.chipFailed, icon: '✗', label: 'Fail' },
  partial: { cls: styles.chipPending, icon: '◐', label: 'Partial' },
};

const SCENARIO_ICON: Record<AuditScenarioResult, string> = {
  pass: '✅',
  fail: '❌',
  skip: '⏭️',
};

function ResultChip({ overall }: { overall: AuditOverallResult }) {
  const chip = OVERALL_CHIP[overall];
  return (
    <span className={`${styles.chip} ${chip.cls}`}>
      {chip.icon} {chip.label}
    </span>
  );
}

function AuditRunDetail({ run }: { run: AuditRun }) {
  return (
    <div style={{ padding: 'var(--space-4) var(--space-5)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
      {run.summary ? <p style={{ fontSize: '0.875rem', marginBottom: 'var(--space-3)' }}>{run.summary}</p> : null}
      {run.scenarios.length === 0 ? (
        <p className={styles.cellMuted}>No per-scenario detail was reported for this run.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th} style={{ width: 60 }}>ID</th>
                <th className={styles.th}>Scenario</th>
                <th className={styles.th} style={{ width: 90 }}>Result</th>
                <th className={styles.th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {run.scenarios.map((s) => (
                <tr key={s.id} className={styles.trHover}>
                  <td className={styles.td}>{s.id}</td>
                  <td className={styles.td}>{s.name}</td>
                  <td className={styles.td}>{SCENARIO_ICON[s.result]}</td>
                  <td className={styles.td}>{s.note || <span className={styles.cellMuted}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.cellMuted} style={{ fontSize: '0.75rem', marginTop: 'var(--space-3)', marginBottom: 0 }}>
        {run.group ? `Group: ${run.group} · ` : ''}Runner: {run.runner}
      </p>
    </div>
  );
}

export default function AuditsPage() {
  const { user, loading: authLoading } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

  const [runsByAudit, setRunsByAudit] = useState<Record<string, AuditRun>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLatestAuditRuns();
      const byName: Record<string, AuditRun> = {};
      result.runs.forEach((run) => {
        byName[run.auditName] = run;
      });
      setRunsByAudit(byName);
    } catch {
      setError(GENERIC_LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    load();
  }, [isSuperadmin, load]);

  // Wait for the auth check itself to settle before deciding access — user
  // starts null/loading on every mount, so checking isSuperadmin alone would
  // flash "Access denied" at a real superadmin for one render while their
  // own session is still loading.
  if (authLoading) {
    return null;
  }

  // The admin shell already gates admin/superadmin — this page additionally
  // requires superadmin specifically (real payment/Stripe-test-run data).
  if (!isSuperadmin) {
    return (
      <main>
        <Alert variant="error">Access denied — superadmin only.</Alert>
      </main>
    );
  }

  return (
    <main>
      <AdminPageHeader title="Audits" subtitle="Latest live-audit script results, reported from staging" />

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">
            {error}{' '}
            <button type="button" className={styles.btnSecondary} style={{ marginLeft: 'var(--space-2)' }} onClick={load}>
              Retry
            </button>
          </Alert>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead className={styles.tHead}>
            <tr>
              <th className={styles.th}>Audit</th>
              <th className={styles.th}>Last Result</th>
              <th className={styles.th}>Last Run</th>
              <th className={styles.th} style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <AdminLoadingRow colSpan={4} />
            ) : (
              KNOWN_AUDITS.map((audit) => {
                const run = runsByAudit[audit.key];
                const isExpanded = expandedKey === audit.key;
                return (
                  <Fragment key={audit.key}>
                    <tr
                      className={styles.trHover}
                      style={{ cursor: run ? 'pointer' : 'default' }}
                      onClick={() => run && setExpandedKey(isExpanded ? null : audit.key)}
                    >
                      <td className={styles.td}>{audit.label}</td>
                      <td className={styles.td}>
                        {run ? (
                          <ResultChip overall={run.overall} />
                        ) : (
                          <span className={`${styles.chip} ${styles.chipNeutral}`}>Never run</span>
                        )}
                      </td>
                      <td className={styles.td}>
                        {run ? formatRelativeTime(run.finishedAt) : <span className={styles.cellMuted}>—</span>}
                      </td>
                      <td className={styles.td}>
                        {run ? (
                          <button
                            type="button"
                            className={styles.btnIcon}
                            aria-label={isExpanded ? `Collapse ${audit.label}` : `Expand ${audit.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedKey(isExpanded ? null : audit.key);
                            }}
                          >
                            <ChevronRight
                              size={14}
                              style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}
                            />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {isExpanded && run ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <AuditRunDetail run={run} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
