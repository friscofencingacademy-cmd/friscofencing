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

interface PackRow {
  quantity: string;
  discountPercent: string;
}

interface FormState {
  registrationFee: string;
  returningStudentGracePeriodMonths: string;
  privateClassPackages: PackRow[];
}

function toForm(settings: Setting): FormState {
  return {
    registrationFee: String(settings.registrationFee),
    returningStudentGracePeriodMonths: String(settings.returningStudentGracePeriodMonths),
    privateClassPackages: settings.privateClassPackages.map((pack) => ({
      quantity: String(pack.quantity),
      discountPercent: String(pack.discountPercent),
    })),
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

  function setPack(index: number, key: keyof PackRow, value: string) {
    if (!form) return;
    setField(
      'privateClassPackages',
      form.privateClassPackages.map((pack, i) => (i === index ? { ...pack, [key]: value } : pack))
    );
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

    // Numbers only here — which packs are valid (whole quantities of at least
    // 2, no duplicates, discount range) is the backend's rule; its message is
    // shown verbatim if it refuses.
    const privateClassPackages = form.privateClassPackages.map((pack) => ({
      quantity: Number(pack.quantity),
      discountPercent: Number(pack.discountPercent),
    }));

    if (privateClassPackages.some((pack) => pack.quantity === 0 || Number.isNaN(pack.quantity) || Number.isNaN(pack.discountPercent))) {
      setSaveError('Each pack needs a number of sessions and a discount (use 0 for none).');
      return;
    }

    setSaveError(null);
    setSaving(true);

    const result = await updateSettings({
      registrationFee,
      returningStudentGracePeriodMonths,
      privateClassPackages,
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
      <AdminPageHeader title="Settings" subtitle="Registration fee and private-lesson packs" />

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

          <div className={styles.formGroup}>
            <span className={styles.label}>Private-lesson packs</span>
            <p className={styles.formHint}>
              Discounted bundles parents can buy when booking a private lesson. A single session at full price is
              always offered.
            </p>
            {form.privateClassPackages.map((pack, index) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no identity until saved
              <div key={index} className={styles.formRow} style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                <input
                  aria-label={`Pack ${index + 1} sessions`}
                  type="number"
                  min="2"
                  step="1"
                  className={styles.input}
                  placeholder="Sessions"
                  value={pack.quantity}
                  onChange={(e) => setPack(index, 'quantity', e.target.value)}
                />
                <input
                  aria-label={`Pack ${index + 1} discount percent`}
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  className={styles.input}
                  placeholder="Discount %"
                  value={pack.discountPercent}
                  onChange={(e) => setPack(index, 'discountPercent', e.target.value)}
                />
                <button
                  type="button"
                  className={styles.btnSecondary}
                  aria-label={`Remove pack ${index + 1}`}
                  onClick={() =>
                    setField(
                      'privateClassPackages',
                      form.privateClassPackages.filter((_, i) => i !== index)
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() =>
                setField('privateClassPackages', [...form.privateClassPackages, { quantity: '', discountPercent: '' }])
              }
            >
              Add pack
            </button>
          </div>

          <button type="button" className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </main>
  );
}
