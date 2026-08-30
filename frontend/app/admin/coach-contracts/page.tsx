'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchUsers } from '../../../lib/services/users';
import { createCoachContract, deactivateCoachContract, fetchCoachContracts } from '../../../lib/services/coachContracts';
import { formatInstant } from '../../../lib/formatDate';
import type { AuthUser, CoachContract } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface ContractForm {
  coachId: string;
  studentBillingRate: string;
  coachCompensationRate: string;
  sessionDurationMinutes: string;
}

const EMPTY_FORM: ContractForm = {
  coachId: '',
  studentBillingRate: '',
  coachCompensationRate: '',
  sessionDurationMinutes: '60',
};

// effectiveFrom defaults to Date.now (coachContract.model.js) — a real
// instant, not a calendar-day sentinel — so it renders via formatInstant
// (Central-anchored), never formatDateOnly (docs/plans/
// utc-date-standard-plan.md).
function formatDate(iso: string): string {
  return formatInstant(iso);
}

// coachId is null when the coach was deleted without a delete-guard
// blocking it (orphaned-coach-reference-fix-plan D2) — never assume it's
// populated.
function coachLabel(coachId: CoachContract['coachId']): string {
  return coachId ? `${coachId.firstName} ${coachId.lastName}` : 'Coach no longer available';
}

async function fetchCoachContractsPageData() {
  const [contracts, coaches] = await Promise.all([fetchCoachContracts(), fetchUsers('coach')]);
  return { contracts, coaches };
}

export default function AdminCoachContractsPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchCoachContractsPageData, []);
  const [contracts, setContracts] = useState<CoachContract[]>([]);
  const [coaches, setCoaches] = useState<AuthUser[]>([]);

  useEffect(() => {
    if (data) {
      setContracts(data.contracts);
      setCoaches(data.coaches);
    }
  }, [data]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<CoachContract | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setDialogError(null);
  }

  function setField(key: keyof ContractForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setDialogError(null);

    const studentBillingRate = Number(form.studentBillingRate);
    const coachCompensationRate = Number(form.coachCompensationRate);
    const sessionDurationMinutes = Number(form.sessionDurationMinutes);

    if (
      !form.coachId ||
      form.studentBillingRate.trim() === '' ||
      Number.isNaN(studentBillingRate) ||
      form.coachCompensationRate.trim() === '' ||
      Number.isNaN(coachCompensationRate)
    ) {
      setDialogError('Coach, billing rate, and compensation rate are required.');
      return;
    }

    setSaving(true);

    const result = await createCoachContract({
      coachId: form.coachId,
      studentBillingRate,
      coachCompensationRate,
      sessionDurationMinutes: Number.isNaN(sessionDurationMinutes) ? undefined : sessionDurationMinutes,
    });

    setSaving(false);

    if (result.status === 'success') {
      setDialogOpen(false);
      retry();
    } else {
      setDialogError(result.message);
    }
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;

    setDeactivating(true);
    setDeactivateError(null);

    const result = await deactivateCoachContract(deactivateTarget._id);

    setDeactivating(false);

    if (result.status === 'success') {
      setDeactivateTarget(null);
      retry();
    } else {
      setDeactivateError(result.message);
    }
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Coach Contracts" count={isLoading ? undefined : contracts.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Contract
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Coach</th>
                <th className={styles.th}>$/hr Billed</th>
                <th className={styles.th}>$/hr Comp</th>
                <th className={styles.th}>Duration</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Since</th>
                <th className={styles.th} style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={7} />
              ) : contracts.length === 0 ? (
                <AdminEmptyRow colSpan={7} message="No coach contracts found" />
              ) : (
                contracts.map((contract) => (
                  <tr key={contract._id} className={styles.trHover}>
                    <td className={styles.td}>{coachLabel(contract.coachId)}</td>
                    <td className={styles.td}>${contract.studentBillingRate.toFixed(2)}</td>
                    <td className={styles.td}>${contract.coachCompensationRate.toFixed(2)}</td>
                    <td className={styles.td}>{contract.sessionDurationMinutes} min</td>
                    <td className={styles.td}>
                      {contract.isActive ? (
                        <span className={`${styles.chip} ${styles.chipActive}`}>Active</span>
                      ) : (
                        <span className={styles.chipMuted}>Inactive</span>
                      )}
                    </td>
                    <td className={styles.td}>{formatDate(contract.effectiveFrom)}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      {contract.isActive ? (
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => {
                            setDeactivateError(null);
                            setDeactivateTarget(contract);
                          }}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <span className={styles.cellMuted}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={dialogOpen}
        onClose={closeDialog}
        title="Add Contract"
        disableClose={saving}
        footer={
          <>
            <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
          </>
        }
      >
        {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="contract-coachId">
            Coach
          </label>
          <select
            id="contract-coachId"
            className={styles.select}
            value={form.coachId}
            onChange={(e) => setField('coachId', e.target.value)}
          >
            <option value="">Select a coach</option>
            {coaches.map((coach) => (
              <option key={coach._id} value={coach._id}>
                {coach.firstName} {coach.lastName}
              </option>
            ))}
          </select>
          <div className={styles.formHint}>
            Creating a contract replaces the coach&apos;s current active contract.
          </div>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="contract-studentBillingRate">
            Rate Billed to Parent ($/hr)
          </label>
          <input
            id="contract-studentBillingRate"
            type="number"
            min={0}
            className={styles.input}
            value={form.studentBillingRate}
            onChange={(e) => setField('studentBillingRate', e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="contract-coachCompensationRate">
            Coach Compensation ($/hr)
          </label>
          <input
            id="contract-coachCompensationRate"
            type="number"
            min={0}
            className={styles.input}
            value={form.coachCompensationRate}
            onChange={(e) => setField('coachCompensationRate', e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="contract-sessionDurationMinutes">
            Default Session Duration (min)
          </label>
          <input
            id="contract-sessionDurationMinutes"
            type="number"
            min={15}
            className={styles.input}
            value={form.sessionDurationMinutes}
            onChange={(e) => setField('sessionDurationMinutes', e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate Contract"
        size="sm"
        hideCloseButton
        disableClose={deactivating}
        footer={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setDeactivateTarget(null)}
              disabled={deactivating}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnDangerFilled}
              onClick={handleDeactivateConfirm}
              disabled={deactivating}
            >
              {deactivating ? 'Deactivating…' : 'Deactivate'}
            </button>
          </>
        }
      >
        {deactivateError ? <Alert variant="error">{deactivateError}</Alert> : null}
        <p style={{ margin: 0 }}>
          Deactivate {deactivateTarget ? coachLabel(deactivateTarget.coachId) : ''}&apos;s contract? They will no
          longer be able to publish new private-lesson slots.
        </p>
      </Modal>
    </main>
  );
}
