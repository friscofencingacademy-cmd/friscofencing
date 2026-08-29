'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import {
  createGroupClass,
  deleteGroupClass,
  fetchGroupClasses,
  fetchLevels,
  fetchLocations,
  updateGroupClass,
} from '../../../lib/services/catalog';
import type { GroupClass, Level, Location } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import Modal from '../../components/ui/Modal/Modal';
import styles from '../../components/admin/admin.module.css';

interface ClassForm {
  name: string;
  levelId: string;
  locationId: string;
  capacity: string;
}

const EMPTY_FORM: ClassForm = { name: '', levelId: '', locationId: '', capacity: '' };

interface DialogState {
  open: boolean;
  id: string | null;
  form: ClassForm;
}

interface DeleteTarget {
  id: string;
  name: string;
}

async function fetchClassesPageData() {
  const [groupClasses, levels, locations] = await Promise.all([
    fetchGroupClasses(),
    fetchLevels(),
    fetchLocations(),
  ]);
  return { groupClasses, levels, locations };
}

function levelName(levels: Level[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

function locationName(locations: Location[], id: string): string {
  return locations.find((location) => location._id === id)?.name ?? id;
}

export default function ClassesPage() {
  const { data, error, isLoading, retry } = useLoadState(fetchClassesPageData, []);
  const [items, setItems] = useState<GroupClass[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data.groupClasses);
      setLevels(data.levels);
      setLocations(data.locations);
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

  function openEdit(groupClass: GroupClass) {
    setDialog({
      open: true,
      id: groupClass._id,
      form: {
        name: groupClass.name,
        levelId: groupClass.levelId,
        locationId: groupClass.locationId,
        capacity: String(groupClass.capacity),
      },
    });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField(key: keyof ClassForm, value: string) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    const capacity = Number(dialog.form.capacity);

    if (
      !dialog.form.name.trim() ||
      !dialog.form.levelId ||
      !dialog.form.locationId ||
      dialog.form.capacity.trim() === '' ||
      Number.isNaN(capacity)
    ) {
      setDialogError('Name, level, location, and a valid capacity are required.');
      return;
    }

    setSaving(true);

    const payload = {
      name: dialog.form.name,
      levelId: dialog.form.levelId,
      locationId: dialog.form.locationId,
      capacity,
    };
    const result = dialog.id ? await updateGroupClass(dialog.id, payload) : await createGroupClass(payload);

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

    const result = await deleteGroupClass(deleteTarget.id);

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
        <AdminPageHeader title="Classes" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add Class
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
                <th className={styles.th}>Level</th>
                <th className={styles.th}>Location</th>
                <th className={styles.th}>Capacity</th>
                <th className={styles.th} style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={5} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={5} message="No classes found" />
              ) : (
                items.map((groupClass) => (
                  <tr key={groupClass._id} className={styles.trHover}>
                    <td className={styles.td}>{groupClass.name}</td>
                    <td className={styles.td}>{levelName(levels, groupClass.levelId)}</td>
                    <td className={styles.td}>{locationName(locations, groupClass.locationId)}</td>
                    <td className={styles.td}>{groupClass.capacity}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.actionBtns}>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                          title="Edit"
                          aria-label={`Edit ${groupClass.name}`}
                          onClick={() => openEdit(groupClass)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                          title="Delete"
                          aria-label={`Delete ${groupClass.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget({ id: groupClass._id, name: groupClass.name });
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
        title={dialog.id ? 'Edit Class' : 'Add Class'}
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
          <label className={styles.label} htmlFor="class-name">
            Name
          </label>
          <input
            id="class-name"
            className={styles.input}
            value={dialog.form.name}
            onChange={(e) => setField('name', e.target.value)}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="class-level">
            Level
          </label>
          <select
            id="class-level"
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
          <label className={styles.label} htmlFor="class-location">
            Location
          </label>
          <select
            id="class-location"
            className={styles.select}
            value={dialog.form.locationId}
            onChange={(e) => setField('locationId', e.target.value)}
            required
          >
            <option value="">Select a location</option>
            {locations.map((location) => (
              <option key={location._id} value={location._id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="class-capacity">
            Capacity
          </label>
          <input
            id="class-capacity"
            type="number"
            min={1}
            className={styles.input}
            value={dialog.form.capacity}
            onChange={(e) => setField('capacity', e.target.value)}
            required
          />
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteError ? 'Cannot Delete' : 'Delete Class'}
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
