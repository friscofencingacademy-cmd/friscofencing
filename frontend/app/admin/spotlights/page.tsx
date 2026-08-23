'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  createSpotlight,
  deleteSpotlight,
  fetchSpotlights,
  updateSpotlight,
  uploadSpotlightImage,
} from '../../../lib/services/spotlights';
import type { Spotlight, SpotlightType } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

interface SpotlightForm {
  type: SpotlightType;
  name: string;
  title: string;
  body: string;
  bullet1: string;
  bullet2: string;
  bullet3: string;
  imageUrl: string;
  isPublished: boolean;
  order: string;
}

const EMPTY_FORM: SpotlightForm = {
  type: 'coach',
  name: '',
  title: '',
  body: '',
  bullet1: '',
  bullet2: '',
  bullet3: '',
  imageUrl: '',
  isPublished: false,
  order: '0',
};

function toForm(spotlight: Spotlight): SpotlightForm {
  return {
    type: spotlight.type,
    name: spotlight.name,
    title: spotlight.title ?? '',
    body: spotlight.body ?? '',
    bullet1: spotlight.bullets[0] ?? '',
    bullet2: spotlight.bullets[1] ?? '',
    bullet3: spotlight.bullets[2] ?? '',
    imageUrl: spotlight.imageUrl ?? '',
    isPublished: spotlight.isPublished,
    order: String(spotlight.order),
  };
}

function toPayload(form: SpotlightForm) {
  const bullets = [form.bullet1, form.bullet2, form.bullet3]
    .map((bullet) => bullet.trim())
    .filter(Boolean);

  return {
    type: form.type,
    name: form.name.trim(),
    title: form.title.trim() || undefined,
    body: form.body.trim() || undefined,
    bullets,
    imageUrl: form.imageUrl.trim() || undefined,
    isPublished: form.isPublished,
    order: Number.isNaN(Number(form.order)) ? 0 : Number(form.order),
  };
}

interface DialogState {
  open: boolean;
  id: string | null;
  form: SpotlightForm;
}

interface DeleteTarget {
  id: string;
  name: string;
}

export default function SpotlightsPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchSpotlights, []);
  const [items, setItems] = useState<Spotlight[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data);
    }
  }, [data]);

  const [dialog, setDialog] = useState<DialogState>({ open: false, id: null, form: EMPTY_FORM });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setDialog({ open: true, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function openEdit(spotlight: Spotlight) {
    setDialog({ open: true, id: spotlight._id, form: toForm(spotlight) });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving || uploadingImage) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField<K extends keyof SpotlightForm>(key: K, value: SpotlightForm[K]) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    if (!dialog.form.name.trim()) {
      setDialogError('Name is required.');
      return;
    }

    setSaving(true);

    const payload = toPayload(dialog.form);
    const result = dialog.id
      ? await updateSpotlight(dialog.id, payload)
      : await createSpotlight(payload);

    setSaving(false);

    if (result.status === 'success') {
      setDialog({ open: false, id: null, form: EMPTY_FORM });
      retry();
    } else {
      setDialogError(result.message);
    }
  }

  async function handleImageFileSelected(file: File | undefined) {
    if (!file) return;

    setDialogError(null);
    setUploadingImage(true);

    const result = await uploadSpotlightImage(file);

    setUploadingImage(false);

    if (result.status === 'success') {
      setField('imageUrl', result.data);
    } else {
      setDialogError(result.message);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const result = await deleteSpotlight(deleteTarget.id);

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
        <AdminPageHeader title="Spotlights" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Spotlight
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
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Title</th>
                <th className={styles.th}>Order</th>
                <th className={styles.th}>Published</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={6} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={6} message="No spotlights found" />
              ) : (
                items.map((spotlight) => (
                  <tr key={spotlight._id} className={styles.trHover}>
                    <td className={styles.td}>{spotlight.name}</td>
                    <td className={styles.td}>{spotlight.type}</td>
                    <td className={styles.td}>{spotlight.title || '—'}</td>
                    <td className={styles.td}>{spotlight.order}</td>
                    <td className={styles.td}>{spotlight.isPublished ? 'Yes' : 'No'}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit ${spotlight.name}`}
                          onClick={() => openEdit(spotlight)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete ${spotlight.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: spotlight._id, name: spotlight.name });
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

      {dialog.open ? (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && closeDialog()}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-label={dialog.id ? 'Edit Spotlight' : 'Add Spotlight'}
          >
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>{dialog.id ? 'Edit Spotlight' : 'Add Spotlight'}</h2>
              <button type="button" className={styles.dialogClose} onClick={closeDialog} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-type">
                  Type
                </label>
                <select
                  id="spotlight-type"
                  className={styles.select}
                  value={dialog.form.type}
                  onChange={(e) => setField('type', e.target.value as SpotlightType)}
                >
                  <option value="coach">Coach</option>
                  <option value="student">Student</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-name">
                  Name
                </label>
                <input
                  id="spotlight-name"
                  className={styles.input}
                  value={dialog.form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-title">
                  Title
                </label>
                <input
                  id="spotlight-title"
                  className={styles.input}
                  value={dialog.form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder="e.g. Head Coach"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-body">
                  Body
                </label>
                <textarea
                  id="spotlight-body"
                  className={styles.input}
                  rows={4}
                  value={dialog.form.body}
                  onChange={(e) => setField('body', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-bullet1">
                  Bullet 1
                </label>
                <input
                  id="spotlight-bullet1"
                  className={styles.input}
                  value={dialog.form.bullet1}
                  onChange={(e) => setField('bullet1', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-bullet2">
                  Bullet 2
                </label>
                <input
                  id="spotlight-bullet2"
                  className={styles.input}
                  value={dialog.form.bullet2}
                  onChange={(e) => setField('bullet2', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-bullet3">
                  Bullet 3
                </label>
                <input
                  id="spotlight-bullet3"
                  className={styles.input}
                  value={dialog.form.bullet3}
                  onChange={(e) => setField('bullet3', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-imageUrl">
                  Image URL
                </label>
                <input
                  id="spotlight-imageUrl"
                  className={styles.input}
                  value={dialog.form.imageUrl}
                  onChange={(e) => setField('imageUrl', e.target.value)}
                  placeholder="https://…"
                />
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <label className={styles.label} htmlFor="spotlight-imageFile" style={{ margin: 0 }}>
                    Or upload a file:
                  </label>
                  <input
                    id="spotlight-imageFile"
                    type="file"
                    accept="image/*"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleImageFileSelected(file);
                      e.target.value = '';
                    }}
                  />
                  {uploadingImage ? <span>Uploading…</span> : null}
                </div>
                {dialog.form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- an
                  // owner-hosted/Blob-hosted URL, not a local/optimizable asset.
                  <img
                    src={dialog.form.imageUrl}
                    alt=""
                    style={{
                      marginTop: 'var(--space-2)',
                      width: 80,
                      height: 100,
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                    }}
                  />
                ) : null}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-order">
                  Order
                </label>
                <input
                  id="spotlight-order"
                  type="number"
                  className={styles.input}
                  value={dialog.form.order}
                  onChange={(e) => setField('order', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="spotlight-isPublished">
                  <input
                    id="spotlight-isPublished"
                    type="checkbox"
                    checked={dialog.form.isPublished}
                    onChange={(e) => setField('isPublished', e.target.checked)}
                    style={{ marginRight: 'var(--space-2)' }}
                  />
                  Published
                </label>
              </div>
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleSave}
                disabled={saving || uploadingImage}
              >
                {saving ? 'Saving…' : dialog.id ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className={styles.overlay}
          onClick={(e) => e.target === e.currentTarget && !deleting && setDeleteTarget(null)}
        >
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>{deleteError ? 'Cannot Delete' : 'Delete Spotlight'}</h2>
            </div>
            <div className={styles.dialogBody}>
              <p style={{ margin: 0 }}>
                {deleteError ?? `Delete "${deleteTarget.name}"? This cannot be undone.`}
              </p>
            </div>
            <div className={styles.dialogFooter}>
              {deleteError ? (
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
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
