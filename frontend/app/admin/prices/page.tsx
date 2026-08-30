'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { createPrice, deletePrice, fetchLevels, fetchPrices, updatePrice } from '../../../lib/services/catalog';
import type { Level, Price } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface PriceForm {
  levelId: string;
  monthlyFee: string;
  // Empty string = inherit the academy-wide default. '0' is a real,
  // distinct value (this level charges no registration fee).
  registrationFee: string;
}

const EMPTY_FORM: PriceForm = { levelId: '', monthlyFee: '', registrationFee: '' };

interface DialogState {
  open: boolean;
  id: string | null;
  form: PriceForm;
}

interface DeleteTarget {
  id: string;
  name: string;
}

async function fetchPricesPageData() {
  const [prices, levels] = await Promise.all([fetchPrices(), fetchLevels()]);
  return { prices, levels };
}

function levelName(levels: Level[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

export default function PricesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchPricesPageData, []);
  const [items, setItems] = useState<Price[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data.prices);
      setLevels(data.levels);
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

  function openEdit(price: Price) {
    setDialog({
      open: true,
      id: price._id,
      form: {
        levelId: price.levelId,
        monthlyFee: String(price.monthlyFee),
        registrationFee: price.registrationFee === null || price.registrationFee === undefined
          ? ''
          : String(price.registrationFee),
      },
    });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField(key: keyof PriceForm, value: string) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    const monthlyFee = Number(dialog.form.monthlyFee);

    if (!dialog.form.levelId || dialog.form.monthlyFee.trim() === '' || Number.isNaN(monthlyFee)) {
      setDialogError('A level and a valid monthly fee are required.');
      return;
    }

    // Blank means "inherit the academy-wide default" (sent as an explicit
    // null so an edit can CLEAR a previously-set override). A non-blank
    // value — including '0' — must be a valid, non-negative number.
    const registrationFeeInput = dialog.form.registrationFee.trim();
    let registrationFee: number | null = null;

    if (registrationFeeInput !== '') {
      registrationFee = Number(registrationFeeInput);

      if (Number.isNaN(registrationFee) || registrationFee < 0) {
        setDialogError('Registration fee must be a valid, non-negative number, or left blank.');
        return;
      }
    }

    setSaving(true);

    const payload = { levelId: dialog.form.levelId, monthlyFee, registrationFee };
    const result = dialog.id ? await updatePrice(dialog.id, payload) : await createPrice(payload);

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

    const result = await deletePrice(deleteTarget.id);

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
        <AdminPageHeader title="Prices" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Price
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Level</th>
                <th className={styles.th}>Monthly Fee</th>
                <th className={styles.th}>Registration Fee</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={4} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={4} message="No prices found" />
              ) : (
                items.map((price) => (
                  <tr key={price._id} className={styles.trHover}>
                    <td className={styles.td}>{levelName(levels, price.levelId)}</td>
                    <td className={styles.td}>{price.monthlyFee}</td>
                    <td className={styles.td}>
                      {price.registrationFee === null || price.registrationFee === undefined
                        ? 'Default'
                        : price.registrationFee}
                    </td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit ${levelName(levels, price.levelId)} price`}
                          onClick={() => openEdit(price)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete ${levelName(levels, price.levelId)} price`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: price._id, name: levelName(levels, price.levelId) });
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
        title={dialog.id ? 'Edit Price' : 'Add Price'}
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
          <label className={styles.label} htmlFor="price-level">
            Level
          </label>
          <select
            id="price-level"
            className={styles.select}
            value={dialog.form.levelId}
            onChange={(e) => setField('levelId', e.target.value)}
            required
          >
            <option value="">Select a level</option>
            {levels.map((level) => (
              <option key={level._id} value={level._id}>
                {level.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="price-monthlyFee">
            Monthly Fee
          </label>
          <input
            id="price-monthlyFee"
            type="number"
            min={0}
            className={styles.input}
            value={dialog.form.monthlyFee}
            onChange={(e) => setField('monthlyFee', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="price-registrationFee">
            Registration Fee
          </label>
          <input
            id="price-registrationFee"
            type="number"
            min={0}
            className={styles.input}
            value={dialog.form.registrationFee}
            onChange={(e) => setField('registrationFee', e.target.value)}
            placeholder="Default"
          />
          <p className={styles.formHint}>
            Leave blank to use the academy-wide default. Enter 0 for no fee at this level.
          </p>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteError ? 'Cannot Delete' : 'Delete Price'}
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
        <p style={{ margin: 0 }}>
          {deleteError ?? `Delete the price for "${deleteTarget?.name}"? This cannot be undone.`}
        </p>
      </Modal>
    </main>
  );
}
