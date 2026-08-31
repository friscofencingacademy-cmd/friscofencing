'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { createHoliday, deleteHoliday, fetchHolidays, updateHoliday } from '../../../lib/services/catalog';
import { formatDateOnly } from '../../../lib/formatDate';
import type { Holiday } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface HolidayForm {
  name: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: HolidayForm = { name: '', startDate: '', endDate: '' };

interface DialogState {
  open: boolean;
  id: string | null;
  form: HolidayForm;
}

interface DeleteTarget {
  id: string;
  name: string;
}

// A holiday's startDate/endDate are calendar-day sentinel ISO strings
// (e.g. '2026-12-24T00:00:00.000Z') — slicing the first 10 characters
// yields the 'YYYY-MM-DD' shape an <input type="date"> needs, with zero
// timezone reinterpretation. Never round-trip through `new Date(iso)` and
// local getters here (docs/plans/utc-date-standard-plan.md).
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export default function HolidaysPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchHolidays, []);
  const [items, setItems] = useState<Holiday[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data);
    }
  }, [data]);

  const [dialog, setDialog] = useState<DialogState>({ open: false, id: null, form: EMPTY_FORM });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setDialog({ open: true, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function openEdit(holiday: Holiday) {
    setDialog({
      open: true,
      id: holiday._id,
      form: {
        name: holiday.name,
        startDate: toDateInputValue(holiday.startDate),
        endDate: toDateInputValue(holiday.endDate),
      },
    });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField(key: keyof HolidayForm, value: string) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    if (!dialog.form.name.trim() || !dialog.form.startDate || !dialog.form.endDate) {
      setDialogError('Name, start date, and end date are all required.');
      return;
    }

    setSaving(true);

    const payload = {
      name: dialog.form.name,
      startDate: dialog.form.startDate,
      endDate: dialog.form.endDate,
    };
    const result = dialog.id ? await updateHoliday(dialog.id, payload) : await createHoliday(payload);

    setSaving(false);

    if (result.status === 'success') {
      setDialog({ open: false, id: null, form: EMPTY_FORM });
      retry();
    } else {
      setDialogError(result.message);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const result = await deleteHoliday(deleteTarget.id);

    setDeleting(false);

    if (result.status === 'success') {
      setItems((prev) => prev.filter((item) => item._id !== deleteTarget.id));
      setDeleteTarget(null);
    } else {
      setDeleteError(result.message);
    }
  }

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Holidays" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Holiday
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Start Date</th>
                <th className={styles.th}>End Date</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={4} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={4} message="No holidays found" />
              ) : (
                items.map((holiday) => (
                  <tr key={holiday._id} className={styles.trHover}>
                    <td className={styles.td}>{holiday.name}</td>
                    <td className={styles.td}>{formatDateOnly(holiday.startDate)}</td>
                    <td className={styles.td}>{formatDateOnly(holiday.endDate)}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit ${holiday.name}`}
                          onClick={() => openEdit(holiday)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete ${holiday.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: holiday._id, name: holiday.name });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={dialog.open}
        onClose={closeDialog}
        title={dialog.id ? 'Edit Holiday' : 'Add Holiday'}
        disableClose={saving}
        footer={
          <>
            <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : dialog.id ? 'Save Changes' : 'Create'}
            </button>
          </>
        }
      >
        {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="holiday-name">
            Name
          </label>
          <input
            id="holiday-name"
            className={styles.input}
            value={dialog.form.name}
            onChange={(e) => setField('name', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="holiday-start-date">
            Start Date
          </label>
          <input
            id="holiday-start-date"
            type="date"
            className={styles.input}
            value={dialog.form.startDate}
            onChange={(e) => setField('startDate', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="holiday-end-date">
            End Date
          </label>
          <input
            id="holiday-end-date"
            type="date"
            className={styles.input}
            value={dialog.form.endDate}
            onChange={(e) => setField('endDate', e.target.value)}
            required
          />
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteError ? 'Cannot Delete' : 'Delete Holiday'}
        size="sm"
        hideCloseButton
        disableClose={deleting}
        footer={
          deleteError ? (
            <button type="button" className={styles.btnSecondary} onClick={() => setDeleteTarget(null)}>
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnDangerFilled}
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )
        }
      >
        <p style={{ margin: 0 }}>{deleteError ?? `Delete "${deleteTarget?.name}"? This cannot be undone.`}</p>
      </Modal>
    </main>
  );
}
