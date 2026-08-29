'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  createTestimonial,
  deleteTestimonial,
  fetchTestimonials,
  updateTestimonial,
  uploadTestimonialImage,
} from '../../../lib/services/testimonials';
import type { Testimonial } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface TestimonialForm {
  quote: string;
  authorName: string;
  caption: string;
  imageUrl: string;
  isPublished: boolean;
  order: string;
}

const EMPTY_FORM: TestimonialForm = {
  quote: '',
  authorName: '',
  caption: '',
  imageUrl: '',
  isPublished: false,
  order: '0',
};

function toForm(testimonial: Testimonial): TestimonialForm {
  return {
    quote: testimonial.quote,
    authorName: testimonial.authorName,
    caption: testimonial.caption ?? '',
    imageUrl: testimonial.imageUrl ?? '',
    isPublished: testimonial.isPublished,
    order: String(testimonial.order),
  };
}

function toPayload(form: TestimonialForm) {
  return {
    quote: form.quote.trim(),
    authorName: form.authorName.trim(),
    caption: form.caption.trim() || undefined,
    imageUrl: form.imageUrl.trim() || undefined,
    isPublished: form.isPublished,
    order: Number.isNaN(Number(form.order)) ? 0 : Number(form.order),
  };
}

interface DialogState {
  open: boolean;
  id: string | null;
  form: TestimonialForm;
}

interface DeleteTarget {
  id: string;
  authorName: string;
}

export default function TestimonialsPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchTestimonials, []);
  const [items, setItems] = useState<Testimonial[]>([]);

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

  function openEdit(testimonial: Testimonial) {
    setDialog({ open: true, id: testimonial._id, form: toForm(testimonial) });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving || uploadingImage) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField<K extends keyof TestimonialForm>(key: K, value: TestimonialForm[K]) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    if (!dialog.form.quote.trim() || !dialog.form.authorName.trim()) {
      setDialogError('Quote and author name are required.');
      return;
    }

    setSaving(true);

    const payload = toPayload(dialog.form);
    const result = dialog.id
      ? await updateTestimonial(dialog.id, payload)
      : await createTestimonial(payload);

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

    const result = await uploadTestimonialImage(file);

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

    const result = await deleteTestimonial(deleteTarget.id);

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
        <AdminPageHeader title="Testimonials" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Testimonial
        </button>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Author</th>
                <th className={styles.th}>Quote</th>
                <th className={styles.th}>Order</th>
                <th className={styles.th}>Published</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={5} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={5} message="No testimonials found" />
              ) : (
                items.map((testimonial) => (
                  <tr key={testimonial._id} className={styles.trHover}>
                    <td className={styles.td}>{testimonial.authorName}</td>
                    <td className={styles.td}>
                      {testimonial.quote.length > 60
                        ? `${testimonial.quote.slice(0, 60)}…`
                        : testimonial.quote}
                    </td>
                    <td className={styles.td}>{testimonial.order}</td>
                    <td className={styles.td}>{testimonial.isPublished ? 'Yes' : 'No'}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit testimonial by ${testimonial.authorName}`}
                          onClick={() => openEdit(testimonial)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete testimonial by ${testimonial.authorName}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: testimonial._id, authorName: testimonial.authorName });
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
        title={dialog.id ? 'Edit Testimonial' : 'Add Testimonial'}
        disableClose={saving || uploadingImage}
        footer={
          <>
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
          </>
        }
      >
        {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="testimonial-quote">
            Quote
          </label>
          <textarea
            id="testimonial-quote"
            className={styles.input}
            rows={4}
            value={dialog.form.quote}
            onChange={(e) => setField('quote', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="testimonial-authorName">
            Author Name
          </label>
          <input
            id="testimonial-authorName"
            className={styles.input}
            value={dialog.form.authorName}
            onChange={(e) => setField('authorName', e.target.value)}
            placeholder="e.g. Steve"
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="testimonial-caption">
            Caption
          </label>
          <input
            id="testimonial-caption"
            className={styles.input}
            value={dialog.form.caption}
            onChange={(e) => setField('caption', e.target.value)}
            placeholder="e.g. More than a sport, an environment for growth"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="testimonial-imageUrl">
            Image URL
          </label>
          <input
            id="testimonial-imageUrl"
            className={styles.input}
            value={dialog.form.imageUrl}
            onChange={(e) => setField('imageUrl', e.target.value)}
            placeholder="https://…"
          />
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <label className={styles.label} htmlFor="testimonial-imageFile" style={{ margin: 0 }}>
              Or upload a file:
            </label>
            <input
              id="testimonial-imageFile"
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
          <label className={styles.label} htmlFor="testimonial-order">
            Order
          </label>
          <input
            id="testimonial-order"
            type="number"
            className={styles.input}
            value={dialog.form.order}
            onChange={(e) => setField('order', e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="testimonial-isPublished">
            <input
              id="testimonial-isPublished"
              type="checkbox"
              checked={dialog.form.isPublished}
              onChange={(e) => setField('isPublished', e.target.checked)}
              style={{ marginRight: 'var(--space-2)' }}
            />
            Published
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteError ? 'Cannot Delete' : 'Delete Testimonial'}
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
          {deleteError ?? `Delete the testimonial by "${deleteTarget?.authorName}"? This cannot be undone.`}
        </p>
      </Modal>
    </main>
  );
}
