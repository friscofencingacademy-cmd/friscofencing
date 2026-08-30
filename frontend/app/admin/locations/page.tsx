'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { createLocation, deleteLocation, fetchLocations, updateLocation } from '../../../lib/services/catalog';
import type { Location } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface LocationForm {
  name: string;
  address: string;
  timezone: string;
  phone: string;
  email: string;
}

const EMPTY_FORM: LocationForm = { name: '', address: '', timezone: 'America/Chicago', phone: '', email: '' };

interface DialogState {
  open: boolean;
  id: string | null;
  form: LocationForm;
}

interface DeleteTarget {
  id: string;
  name: string;
}

export default function LocationsPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchLocations, []);
  const [items, setItems] = useState<Location[]>([]);

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

  function openEdit(location: Location) {
    setDialog({
      open: true,
      id: location._id,
      form: {
        name: location.name,
        address: location.address,
        timezone: location.timezone,
        phone: location.phone,
        email: location.email,
      },
    });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField(key: keyof LocationForm, value: string) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    if (!dialog.form.name.trim() || !dialog.form.address.trim()) {
      setDialogError('Name and address are required.');
      return;
    }

    setSaving(true);

    const result = dialog.id
      ? await updateLocation(dialog.id, dialog.form)
      : await createLocation(dialog.form);

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

    const result = await deleteLocation(deleteTarget.id);

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
        <AdminPageHeader title="Locations" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Location
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
                <th className={styles.th}>Address</th>
                <th className={styles.th}>Timezone</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={4} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={4} message="No locations found" />
              ) : (
                items.map((location) => (
                  <tr key={location._id} className={styles.trHover}>
                    <td className={styles.td}>{location.name}</td>
                    <td className={styles.td}>{location.address}</td>
                    <td className={styles.td}>{location.timezone}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit ${location.name}`}
                          onClick={() => openEdit(location)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete ${location.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: location._id, name: location.name });
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
        title={dialog.id ? 'Edit Location' : 'Add Location'}
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
          <label className={styles.label} htmlFor="loc-name">
            Name
          </label>
          <input
            id="loc-name"
            className={styles.input}
            value={dialog.form.name}
            onChange={(e) => setField('name', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="loc-address">
            Address
          </label>
          <input
            id="loc-address"
            className={styles.input}
            value={dialog.form.address}
            onChange={(e) => setField('address', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="loc-timezone">
            Timezone
          </label>
          <input
            id="loc-timezone"
            className={styles.input}
            value={dialog.form.timezone}
            onChange={(e) => setField('timezone', e.target.value)}
          />
        </div>
        {/* Optional — public phone/email shown on the site's footer and
            home page (docs/plans/frontend-polish-plan.md PR 5.3). Fill
            these in whenever the real values are ready; left blank, the
            public site simply doesn't render them. */}
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="loc-phone">
            Phone <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="loc-phone"
            className={styles.input}
            value={dialog.form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder="(XXX) XXX-XXXX"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="loc-email">
            Email <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="loc-email"
            type="email"
            className={styles.input}
            value={dialog.form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="contact@example.com"
          />
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteError ? 'Cannot Delete' : 'Delete Location'}
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
