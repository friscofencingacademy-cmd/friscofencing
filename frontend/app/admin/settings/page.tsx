'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useLoadState, getErrorMessage } from '../../../lib/hooks/useLoadState';
import { fetchSettings, updateSettings } from '../../../lib/services/settings';
import type { Setting } from '../../../lib/types';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/admin/admin.module.css';

interface FormState {
  registrationFee: string;
  returningStudentGracePeriodMonths: string;
}

function toForm(settings: Setting): FormState {
  return {
    registrationFee: String(settings.registrationFee),
    returningStudentGracePeriodMonths: String(settings.returningStudentGracePeriodMonths),
  };
}

export default function AdminSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

  const { data, error, isLoading, retry } = useLoadState(fetchSettings, []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(toForm(data));
    }
  }, [data]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!form) return;

    const registrationFee = Number(form.registrationFee);
    const returningStudentGracePeriodMonths = Number(form.returningStudentGracePeriodMonths);

    if (Number.isNaN(registrationFee) || registrationFee < 0) {
      setSaveError('Registration fee must be a number ≥ 0.');
      return;
    }

    if (Number.isNaN(returningStudentGracePeriodMonths) || returningStudentGracePeriodMonths < 0) {
      setSaveError('Grace period (months) must be a number ≥ 0.');
      return;
    }

    setSaveError(null);
    setSaving(true);

    const result = await updateSettings({
      registrationFee,
      returningStudentGracePeriodMonths,
    });

    setSaving(false);

    if (result.status === 'success') {
      setForm(toForm(result.data));
      setSaved(true);
    } else {
      setSaveError(result.message);
    }
  }

  // Wait for the auth check itself to settle before deciding access — same
  // pattern as /admin/audits, so a real superadmin never flashes "Access
  // denied" for one render while their own session is still loading.
  if (authLoading) {
    return null;
  }

  // The admin shell already gates admin/superadmin — this page additionally
  // requires superadmin specifically, since these values change the charge
  // on every future registration immediately, with no confirmation step.
  if (!isSuperadmin) {
    return (
      <main>
        <Alert variant="error">Access denied — superadmin only.</Alert>
      </main>
    );
  }

  return (
    <main>
      <AdminPageHeader title="Settings" subtitle="Default registration fee, charged as a one-time add-on at signup" />

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={retry} />
      ) : isLoading || !form ? (
        <p>Loading...</p>
      ) : (
        <div className={styles.tableWrap} style={{ padding: 'var(--space-5)', maxWidth: 480 }}>
          {saveError ? <Alert variant="error">{saveError}</Alert> : null}
          {saved ? <Alert variant="success">Settings saved.</Alert> : null}

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="registration-fee">
              Default Registration Fee ($)
            </label>
            <input
              id="registration-fee"
              type="number"
              min="0"
              step="0.01"
              className={styles.input}
              value={form.registrationFee}
              onChange={(e) => setField('registrationFee', e.target.value)}
            />
            <p className={styles.formHint}>
              Academy-wide one-time charge added to a family&apos;s first month at registration. $0
              means no fee is charged — this is the default until you set one. A level can override
              this on the Prices page.
            </p>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="grace-period">
              Waive if returning within (months)
            </label>
            <input
              id="grace-period"
              type="number"
              min="0"
              step="1"
              className={styles.input}
              value={form.returningStudentGracePeriodMonths}
              onChange={(e) => setField('returningStudentGracePeriodMonths', e.target.value)}
            />
            <p className={styles.formHint}>
              A student who re-registers within this many months of a prior enrollment ending pays no
              registration fee. 0 means the fee always applies, even to a returning student.
            </p>
          </div>

          <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </main>
  );
}
