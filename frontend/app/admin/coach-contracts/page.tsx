'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  packDraftsFromRows,
  packRowsFromPacks,
  parseNonNegative,
  useContractPreview,
  type PackEditorRow,
} from '../../../lib/hooks/useContractPreview';
import { fetchUsers } from '../../../lib/services/users';
import {
  createCoachContract,
  deactivateCoachContract,
  fetchCoachContracts,
  reviseCoachContract,
} from '../../../lib/services/coachContracts';
import { formatInstant } from '../../../lib/formatDate';
import { formatMoney } from '../../../lib/formatMoney';
import { contractStatusLabel, sessionPricesLabel } from '../../../lib/privateLessons';
import type { AuthUser, CoachContract, PrivateLessonPack } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import PackEditor from '../../components/admin/PackEditor/PackEditor';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

// Coach contracts, kept as VERSIONS (docs/plans/coach-pack-pricing-plan.md §8):
// the current version has Edit and Deactivate; saving an edit keeps it as a
// read-only "Replaced" line and starts a new current one. One dialog serves
// Add (a coach with no current contract) and Edit, with a Rates section and a
// Packs section. Every price shown in it comes from the backend preview.

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
  // Most private lessons are 30 minutes (owner decision 2026-09-25).
  sessionDurationMinutes: '30',
};

// effectiveFrom/effectiveTo are real instants, not calendar-day sentinels, so
// they render via formatInstant (docs/plans/utc-date-standard-plan.md).
function formatDate(iso: string | undefined): string {
  return iso ? formatInstant(iso) : '—';
}

// coachId is null when the coach was deleted without a delete-guard
// blocking it (orphaned-coach-reference-fix-plan D2) — never assume it's
// populated.
function coachLabel(coachId: CoachContract['coachId']): string {
  return coachId ? `${coachId.firstName} ${coachId.lastName}` : 'Coach no longer available';
}

// "10 × 30 min — $300.00" — one saved pack, formatted from its stored fields.
function packLine(pack: PrivateLessonPack): string {
  return `${pack.quantity} × ${pack.sessionDurationMinutes} min — ${formatMoney(pack.price)}`;
}

// Display order only: each coach's versions together, newest first.
function sortForDisplay(contracts: CoachContract[]): CoachContract[] {
  return [...contracts].sort(
    (a, b) =>
      coachLabel(a.coachId).localeCompare(coachLabel(b.coachId)) ||
      new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
  );
}

function formFromContract(contract: CoachContract): ContractForm {
  return {
    coachId: contract.coachId ? contract.coachId._id : '',
    studentBillingRate: String(contract.studentBillingRate),
    coachCompensationRate: String(contract.coachCompensationRate),
    sessionDurationMinutes: String(contract.sessionDurationMinutes),
  };
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

  // The one dialog: `editing` null = Add, a contract = Edit that version.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CoachContract | null>(null);
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [packRows, setPackRows] = useState<PackEditorRow[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<CoachContract | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const preview = useContractPreview({
    studentBillingRate: dialogOpen ? parseNonNegative(form.studentBillingRate) : null,
    sessionDurationMinutes: parseNonNegative(form.sessionDurationMinutes),
    rows: packRows,
    coachId: form.coachId || undefined,
  });

  const coachesWithContract = new Set(
    contracts.flatMap((contract) => (contract.isActive && contract.coachId ? [contract.coachId._id] : []))
  );
  const coachesWithoutContract = coaches.filter((coach) => !coachesWithContract.has(coach._id));

  // Edit: whether anything differs from the version being edited (the
  // backend refuses an unchanged save too; this only avoids the round trip).
  const unchanged =
    editing !== null &&
    JSON.stringify(formFromContract(editing)) === JSON.stringify(form) &&
    JSON.stringify(packDraftsFromRows(packRowsFromPacks(editing.privateLessonPacks))) ===
      JSON.stringify(packDraftsFromRows(packRows));

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPackRows([]);
    setDialogError(null);
    setDialogOpen(true);
  }

  function openEdit(contract: CoachContract) {
    setEditing(contract);
    setForm(formFromContract(contract));
    setPackRows(packRowsFromPacks(contract.privateLessonPacks));
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

    const studentBillingRate = parseNonNegative(form.studentBillingRate);
    const coachCompensationRate = parseNonNegative(form.coachCompensationRate);
    const sessionDurationMinutes = parseNonNegative(form.sessionDurationMinutes);

    if (!form.coachId || studentBillingRate === null || coachCompensationRate === null) {
      setDialogError('Coach, billing rate, and compensation rate are required.');
      return;
    }

    const terms = {
      studentBillingRate,
      coachCompensationRate,
      sessionDurationMinutes: sessionDurationMinutes === null ? undefined : sessionDurationMinutes,
      privateLessonPacks: packDraftsFromRows(packRows),
    };

    setSaving(true);

    const result = editing
      ? await reviseCoachContract(editing._id, terms)
      : await createCoachContract({ coachId: form.coachId, ...terms });

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
                <th className={styles.th}>Packs</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Since</th>
                <th className={styles.th}>Until</th>
                <th className={styles.th} style={{ width: 200 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={9} />
              ) : contracts.length === 0 ? (
                <AdminEmptyRow colSpan={9} message="No coach contracts found" />
              ) : (
                sortForDisplay(contracts).map((contract) => (
                  <tr key={contract._id} className={styles.trHover}>
                    <td className={styles.td}>{coachLabel(contract.coachId)}</td>
                    <td className={styles.td}>{formatMoney(contract.studentBillingRate)}</td>
                    <td className={styles.td}>{formatMoney(contract.coachCompensationRate)}</td>
                    <td className={styles.td}>{contract.sessionDurationMinutes} min</td>
                    <td className={styles.td}>
                      {contract.privateLessonPacks.length === 0 ? (
                        <span className={styles.cellMuted}>—</span>
                      ) : (
                        contract.privateLessonPacks.map((pack) => <div key={pack._id}>{packLine(pack)}</div>)
                      )}
                    </td>
                    <td className={styles.td}>
                      {contract.isActive ? (
                        <span className={`${styles.chip} ${styles.chipActive}`}>{contractStatusLabel(contract)}</span>
                      ) : (
                        <span className={styles.chipMuted}>{contractStatusLabel(contract)}</span>
                      )}
                    </td>
                    <td className={styles.td}>{formatDate(contract.effectiveFrom)}</td>
                    <td className={styles.td}>{formatDate(contract.effectiveTo)}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      {contract.isActive ? (
                        <div className={styles.actionBtns}>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            aria-label={`Edit contract for ${coachLabel(contract.coachId)}`}
                            onClick={() => openEdit(contract)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            aria-label={`Deactivate contract for ${coachLabel(contract.coachId)}`}
                            onClick={() => {
                              setDeactivateError(null);
                              setDeactivateTarget(contract);
                            }}
                          >
                            Deactivate
                          </button>
                        </div>
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
        title={editing ? 'Edit Contract' : 'Add Contract'}
        disableClose={saving}
        footer={
          <>
            <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleSave}
              disabled={saving || !preview.canSave || unchanged}
            >
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </button>
          </>
        }
      >
        {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

        {editing ? (
          <p className={styles.formHint} style={{ marginTop: 0 }}>
            {coachLabel(editing.coachId)}. Saving keeps the current version as history and starts a new version
            today. Past purchases keep the price they were bought at.
          </p>
        ) : (
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
              {coachesWithoutContract.map((coach) => (
                <option key={coach._id} value={coach._id}>
                  {coach.firstName} {coach.lastName}
                </option>
              ))}
            </select>
            <div className={styles.formHint}>
              Coaches who already have a contract are not listed — use Edit on their contract instead.
            </div>
          </div>
        )}

        <span className={styles.label}>Rates</span>

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
          {preview.sessionPrices && preview.sessionPrices.length > 0 ? (
            <div className={styles.formHint}>{sessionPricesLabel(preview.sessionPrices)}</div>
          ) : null}
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

        <PackEditor
          rows={packRows}
          onChange={setPackRows}
          statusFor={preview.statusFor}
          disabled={saving}
          defaultMinutes={form.sessionDurationMinutes}
        />
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
          longer be able to publish new private-lesson slots, and parents cannot buy new lessons with them.
        </p>
      </Modal>
    </main>
  );
}
