'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Key, Pencil, Plus, Trash2, X } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { createUser, deleteUser, fetchUsers, updateUser, updateUserPassword } from '../../../lib/services/users';
import type { AuthUser, Role, SkillLevel } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { AdminEmptyRow, AdminLoadingRow } from '../../components/admin/AdminTableRows';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

type TabRole = 'all' | Role;

const BASE_TABS: { value: TabRole; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'parent', label: 'Parent' },
  { value: 'coach', label: 'Coach' },
  { value: 'admin', label: 'Admin' },
  { value: 'student', label: 'Student' },
];

// Roles an admin (or superadmin) may create through this page. Superadmin is
// added conditionally at render time — never here — see design decision
// "Who can create whom" in docs/plans/admin-user-management-plan.md.
const CREATABLE_ROLES: Role[] = ['student', 'parent', 'coach', 'admin'];

const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

// Mirrors backend/src/services/user.service.js's LOGIN_CAPABLE_ROLES — only
// these roles get an email/password and can be password-reset.
const LOGIN_CAPABLE_ROLES: Role[] = ['parent', 'coach', 'admin', 'superadmin'];

interface UserForm {
  role: Role;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  parentId: string;
  skillLevel: string;
}

const EMPTY_FORM: UserForm = {
  role: 'parent',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  parentId: '',
  skillLevel: '',
};

interface DialogState {
  open: boolean;
  id: string | null;
  form: UserForm;
}

interface PasswordDialogState {
  open: boolean;
  id: string | null;
  name: string;
  value: string;
}

interface DeleteTarget {
  id: string;
  name: string;
}

function isKnownRole(value: string): value is Role {
  return value === 'student' || value === 'parent' || value === 'coach' || value === 'admin' || value === 'superadmin';
}

function roleLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isSuperadmin = currentUser?.role === 'superadmin';

  const tabs = isSuperadmin ? [...BASE_TABS, { value: 'superadmin' as TabRole, label: 'Superadmin' }] : BASE_TABS;

  const paramRole = searchParams.get('role');
  const initialTab: TabRole =
    paramRole && isKnownRole(paramRole) && (paramRole !== 'superadmin' || isSuperadmin) ? paramRole : 'all';

  const [selectedTab, setSelectedTab] = useState<TabRole>(initialTab);

  async function fetchUsersPageData() {
    const [users, parentOptions] = await Promise.all([
      fetchUsers(selectedTab === 'all' ? undefined : selectedTab),
      fetchUsers('parent'),
    ]);
    return { users, parentOptions };
  }

  const { data, error, isLoading, retry } = useLoadState(fetchUsersPageData, [selectedTab]);
  const [items, setItems] = useState<AuthUser[]>([]);
  const [parentOptions, setParentOptions] = useState<AuthUser[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data.users);
      setParentOptions(data.parentOptions);
    }
  }, [data]);

  function selectTab(tab: TabRole) {
    setSelectedTab(tab);
    router.replace(tab === 'all' ? '/admin/users' : `/admin/users?role=${tab}`);
  }

  const [dialog, setDialog] = useState<DialogState>({ open: false, id: null, form: EMPTY_FORM });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pwDialog, setPwDialog] = useState<PasswordDialogState>({ open: false, id: null, name: '', value: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function isProtectedRow(row: AuthUser): boolean {
    return row.role === 'superadmin' && !isSuperadmin;
  }

  function openCreate() {
    setDialog({ open: true, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function openEdit(row: AuthUser) {
    setDialog({
      open: true,
      id: row._id,
      form: {
        role: row.role,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email ?? '',
        password: '',
        parentId: row.parentId ?? '',
        skillLevel: row.skillLevel ?? '',
      },
    });
    setDialogError(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog({ open: false, id: null, form: EMPTY_FORM });
    setDialogError(null);
  }

  function setField<K extends keyof UserForm>(key: K, value: UserForm[K]) {
    setDialog((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));
  }

  async function handleSave() {
    setDialogError(null);

    const { form } = dialog;

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setDialogError('First name and last name are required.');
      return;
    }

    if (dialog.id) {
      // Edit: role is immutable and never sent. Email is only part of the
      // payload for a login-capable role — the backend drops it otherwise,
      // so there is no field here to send for a student.
      const isLoginCapable = LOGIN_CAPABLE_ROLES.includes(form.role);

      if (isLoginCapable && !form.email.trim()) {
        setDialogError('Email is required.');
        return;
      }

      setSaving(true);

      const result = await updateUser(dialog.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        ...(isLoginCapable ? { email: form.email.trim() } : {}),
      });

      setSaving(false);

      if (result.status === 'success') {
        setDialog({ open: false, id: null, form: EMPTY_FORM });
        retry();
      } else {
        setDialogError(result.message);
      }

      return;
    }

    // Create
    if (form.role === 'student') {
      if (!form.parentId) {
        setDialogError('Parent is required.');
        return;
      }
    } else if (!form.email.trim() || !form.password) {
      setDialogError('Email and password are required.');
      return;
    } else if (form.password.length < 8) {
      setDialogError('Password must be at least 8 characters.');
      return;
    }

    setSaving(true);

    const result = await createUser(
      form.role === 'student'
        ? {
            role: 'student',
            firstName: form.firstName,
            lastName: form.lastName,
            parentId: form.parentId,
            email: form.email.trim() || undefined,
            skillLevel: (form.skillLevel || undefined) as SkillLevel | undefined,
          }
        : {
            role: form.role,
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email.trim(),
            password: form.password,
          }
    );

    setSaving(false);

    if (result.status === 'success') {
      setDialog({ open: false, id: null, form: EMPTY_FORM });
      retry();
    } else {
      setDialogError(result.message);
    }
  }

  function openPasswordDialog(row: AuthUser) {
    setPwDialog({ open: true, id: row._id, name: `${row.firstName} ${row.lastName}`, value: '' });
    setPwError(null);
  }

  function closePasswordDialog() {
    if (pwSaving) return;
    setPwDialog({ open: false, id: null, name: '', value: '' });
    setPwError(null);
  }

  async function handlePasswordSave() {
    setPwError(null);

    if (!pwDialog.id) return;

    if (pwDialog.value.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }

    setPwSaving(true);
    const result = await updateUserPassword(pwDialog.id, pwDialog.value);
    setPwSaving(false);

    if (result.status === 'success') {
      setPwDialog({ open: false, id: null, name: '', value: '' });
    } else {
      setPwError(result.message);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);

    const result = await deleteUser(deleteTarget.id);

    setDeleting(false);

    if (result.status === 'success') {
      setItems((prev) => prev.filter((item) => item._id !== deleteTarget.id));
      setDeleteTarget(null);
    } else {
      setDeleteError(result.message);
    }
  }

  const isLoginCapableFormRole = LOGIN_CAPABLE_ROLES.includes(dialog.form.role);

  return (
    <main>
      <div className={styles.pageHeaderRow}>
        <AdminPageHeader title="Users" count={isLoading ? undefined : items.length} />
        <button type="button" className={styles.btnPrimary} onClick={openCreate}>
          <Plus size={14} /> Add User
        </button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={selectedTab === tab.value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            style={{ border: 'none', cursor: 'pointer' }}
            aria-pressed={selectedTab === tab.value}
            onClick={() => selectTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tHead}>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Role</th>
                <th className={styles.th}>Email</th>
                <th className={styles.th} style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <AdminLoadingRow colSpan={4} />
              ) : items.length === 0 ? (
                <AdminEmptyRow colSpan={4} message="No users found" />
              ) : (
                items.map((row) => (
                  <tr key={row._id} className={styles.trHover}>
                    <td className={styles.td}>{`${row.firstName} ${row.lastName}`}</td>
                    <td className={styles.td}>
                      <span className={styles.chipMuted}>{roleLabel(row.role)}</span>
                    </td>
                    <td className={styles.td}>{row.email ?? '—'}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      {isProtectedRow(row) ? (
                        <span className={styles.cellMuted}>—</span>
                      ) : (
                        <div className={styles.actionBtns}>
                          <button
                            type="button"
                            className={`${styles.btnIcon} ${styles.btnIconEdit}`}
                            title="Edit"
                            aria-label={`Edit ${row.firstName} ${row.lastName}`}
                            onClick={() => openEdit(row)}
                          >
                            <Pencil size={14} />
                          </button>
                          {LOGIN_CAPABLE_ROLES.includes(row.role) ? (
                            <button
                              type="button"
                              className={styles.btnIcon}
                              title="Change Password"
                              aria-label={`Change password for ${row.firstName} ${row.lastName}`}
                              onClick={() => openPasswordDialog(row)}
                            >
                              <Key size={14} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`${styles.btnIcon} ${styles.btnIconDelete}`}
                            title="Delete"
                            aria-label={`Delete ${row.firstName} ${row.lastName}`}
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget({ id: row._id, name: `${row.firstName} ${row.lastName}` });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
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
          <div className={styles.dialog} role="dialog" aria-label={dialog.id ? 'Edit User' : 'Add User'}>
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>{dialog.id ? 'Edit User' : 'Add User'}</h2>
              <button type="button" className={styles.dialogClose} onClick={closeDialog} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {dialogError ? <Alert variant="error">{dialogError}</Alert> : null}

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="user-role">
                  Role
                </label>
                {dialog.id ? (
                  <div id="user-role">{roleLabel(dialog.form.role)}</div>
                ) : (
                  <select
                    id="user-role"
                    className={styles.select}
                    value={dialog.form.role}
                    onChange={(e) => setField('role', e.target.value as Role)}
                  >
                    {CREATABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                    {isSuperadmin ? <option value="superadmin">Superadmin</option> : null}
                  </select>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="user-firstName">
                  First Name
                </label>
                <input
                  id="user-firstName"
                  className={styles.input}
                  value={dialog.form.firstName}
                  onChange={(e) => setField('firstName', e.target.value)}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="user-lastName">
                  Last Name
                </label>
                <input
                  id="user-lastName"
                  className={styles.input}
                  value={dialog.form.lastName}
                  onChange={(e) => setField('lastName', e.target.value)}
                  required
                />
              </div>

              {!dialog.id && dialog.form.role === 'student' ? (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="user-parentId">
                      Parent
                    </label>
                    <select
                      id="user-parentId"
                      className={styles.select}
                      value={dialog.form.parentId}
                      onChange={(e) => setField('parentId', e.target.value)}
                      required
                    >
                      <option value="">Select a parent</option>
                      {parentOptions.map((parent) => (
                        <option key={parent._id} value={parent._id}>
                          {parent.firstName} {parent.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="user-skillLevel">
                      Skill Level
                    </label>
                    <select
                      id="user-skillLevel"
                      className={styles.select}
                      value={dialog.form.skillLevel}
                      onChange={(e) => setField('skillLevel', e.target.value)}
                    >
                      <option value="">None</option>
                      {SKILL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {roleLabel(level)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="user-email">
                      Email (optional)
                    </label>
                    <input
                      id="user-email"
                      type="email"
                      className={styles.input}
                      value={dialog.form.email}
                      onChange={(e) => setField('email', e.target.value)}
                    />
                  </div>
                </>
              ) : null}

              {!dialog.id && dialog.form.role !== 'student' ? (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="user-email">
                      Email
                    </label>
                    <input
                      id="user-email"
                      type="email"
                      className={styles.input}
                      value={dialog.form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      required
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label} htmlFor="user-password">
                      Password
                    </label>
                    <input
                      id="user-password"
                      type="password"
                      className={styles.input}
                      value={dialog.form.password}
                      onChange={(e) => setField('password', e.target.value)}
                      required
                    />
                    <div className={styles.formHint}>Minimum 8 characters.</div>
                  </div>
                </>
              ) : null}

              {dialog.id && isLoginCapableFormRole ? (
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="user-email">
                    Email
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    className={styles.input}
                    value={dialog.form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    required
                  />
                </div>
              ) : null}
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.btnSecondary} onClick={closeDialog} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : dialog.id ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pwDialog.open ? (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && closePasswordDialog()}>
          <div className={`${styles.dialog} ${styles.dialogSm}`} role="dialog" aria-label="Change Password">
            <div className={styles.dialogHeader}>
              <h2 className={styles.dialogTitle}>Change Password</h2>
              <button type="button" className={styles.dialogClose} onClick={closePasswordDialog} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.dialogBody}>
              {pwError ? <Alert variant="error">{pwError}</Alert> : null}
              <p style={{ marginTop: 0 }}>New password for {pwDialog.name}.</p>
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="user-new-password">
                  New Password
                </label>
                <input
                  id="user-new-password"
                  type="password"
                  className={styles.input}
                  value={pwDialog.value}
                  onChange={(e) => setPwDialog((prev) => ({ ...prev, value: e.target.value }))}
                  required
                />
                <div className={styles.formHint}>Minimum 8 characters.</div>
              </div>
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.btnSecondary} onClick={closePasswordDialog} disabled={pwSaving}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handlePasswordSave} disabled={pwSaving}>
                {pwSaving ? 'Saving…' : 'Save'}
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
              <h2 className={styles.dialogTitle}>{deleteError ? 'Cannot Delete' : 'Delete User'}</h2>
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
