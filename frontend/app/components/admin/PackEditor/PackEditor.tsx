'use client';

import { useEffect } from 'react';

import { useDebouncedValue } from '../../../../lib/hooks/useDebouncedValue';
import { useLoadState } from '../../../../lib/hooks/useLoadState';
import { fetchPackQuotes } from '../../../../lib/services/coachContracts';
import { packPreviewLabel } from '../../../../lib/privateLessons';
import type { PackQuoteRow, PrivateLessonPack, PrivateLessonPackDraft } from '../../../../lib/types';
import adminStyles from '../admin.module.css';
import styles from './PackEditor.module.css';

// The ONE private-lesson pack editor (docs/plans/coach-pack-pricing-plan.md
// D14 e) — rendered by the coach-contract create dialog and by the "Edit
// packs" dialog. It owns the rows, the debounced backend preview (D9a), and
// each row's preview line or refusal reason. It does no price arithmetic:
// every figure and every error message comes from POST /coach-contracts/
// pack-quotes, which runs the same check saving does. The only local check
// is completeness (all three fields filled) — not a pricing rule.

export const PACK_PREVIEW_DEBOUNCE_MS = 400;

// A row as typed. `key` is a stable React key; `_id` is set only for a pack
// that is already saved (sent back so the backend can keep it, plan D7).
export interface PackEditorRow {
  key: string;
  _id?: string;
  sessionDurationMinutes: string;
  quantity: string;
  price: string;
}

let rowCounter = 0;
function nextKey(): string {
  rowCounter += 1;
  return `pack-row-${rowCounter}`;
}

export function packRowsFromPacks(packs: PrivateLessonPack[]): PackEditorRow[] {
  return packs.map((pack) => ({
    key: nextKey(),
    _id: pack._id,
    sessionDurationMinutes: String(pack.sessionDurationMinutes),
    quantity: String(pack.quantity),
    price: String(pack.price),
  }));
}

export function emptyPackRow(defaultMinutes = ''): PackEditorRow {
  return { key: nextKey(), sessionDurationMinutes: defaultMinutes, quantity: '', price: '' };
}

function isComplete(row: PackEditorRow): boolean {
  return row.sessionDurationMinutes.trim() !== '' && row.quantity.trim() !== '' && row.price.trim() !== '';
}

// What is sent to the backend — the typed values as numbers, nothing derived.
export function packDraftsFromRows(rows: PackEditorRow[]): PrivateLessonPackDraft[] {
  return rows.map((row) => ({
    ...(row._id ? { _id: row._id } : {}),
    sessionDurationMinutes: Number(row.sessionDurationMinutes),
    quantity: Number(row.quantity),
    price: Number(row.price),
  }));
}

interface PackEditorProps {
  // The contract's hourly rate, or null while the form's rate is unusable —
  // no preview is requested without one.
  studentBillingRate: number | null;
  rows: PackEditorRow[];
  onChange: (rows: PackEditorRow[]) => void;
  // Called whenever saving should be allowed or not: blocked while a row is
  // incomplete, while its preview is in flight, or while the backend says a
  // row would be refused. A FAILED preview does not block (D9a) — the save's
  // own 400 is the rule.
  onCanSaveChange: (canSave: boolean) => void;
  disabled?: boolean;
  defaultMinutes?: string;
}

export default function PackEditor({
  studentBillingRate,
  rows,
  onChange,
  onCanSaveChange,
  disabled = false,
  defaultMinutes = '',
}: PackEditorProps) {
  const completeRows = rows.filter(isComplete);
  // The request as a string, so it compares by value across renders — the
  // debounce and the fetch re-run only when what would be sent changes.
  const request =
    studentBillingRate === null || completeRows.length === 0
      ? null
      : JSON.stringify({ studentBillingRate, packs: packDraftsFromRows(completeRows) });
  const debouncedRequest = useDebouncedValue(request, PACK_PREVIEW_DEBOUNCE_MS);

  const preview = useLoadState<{ request: string | null; quotes: PackQuoteRow[] }>(
    async () =>
      debouncedRequest === null
        ? { request: null, quotes: [] }
        : { request: debouncedRequest, quotes: await fetchPackQuotes(JSON.parse(debouncedRequest)) },
    [debouncedRequest]
  );

  const fresh = preview.data !== null && preview.data.request === request && !preview.isLoading;
  const previewFailed = !preview.isLoading && preview.error !== null && debouncedRequest === request;

  // The preview for each complete row, in order (the request sent only those).
  const quoteByKey = new Map<string, PackQuoteRow>();
  if (fresh && preview.data) {
    completeRows.forEach((row, index) => {
      const quote = preview.data!.quotes[index];
      if (quote) quoteByKey.set(row.key, quote);
    });
  }

  const anyIncomplete = rows.some((row) => !isComplete(row));
  const anyRefused = [...quoteByKey.values()].some((quote) => quote.error !== null);
  const pending = request !== null && !fresh && !previewFailed;
  const canSave = !anyIncomplete && !anyRefused && !pending;

  useEffect(() => {
    onCanSaveChange(canSave);
  }, [canSave, onCanSaveChange]);

  function setRow(key: string, field: 'sessionDurationMinutes' | 'quantity' | 'price', value: string) {
    // Editing a saved pack keeps its _id; the backend decides whether the id
    // survives (only when nothing changed).
    onChange(rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  return (
    <div className={adminStyles.formGroup}>
      <span className={adminStyles.label}>Private-lesson packs</span>
      <p className={adminStyles.formHint}>
        A fixed price for a number of lessons of one length. A single lesson at the hourly rate is always
        offered.
      </p>

      {rows.map((row, index) => {
        const label = `Pack ${index + 1}`;
        const quote = quoteByKey.get(row.key);

        let status: { text: string; tone: 'hint' | 'error' } | null = null;
        if (!isComplete(row)) {
          status = { text: 'Fill in the lesson length, sessions and price.', tone: 'hint' };
        } else if (studentBillingRate === null) {
          status = { text: 'Set the hourly rate to see this pack’s price check.', tone: 'hint' };
        } else if (previewFailed) {
          status = { text: 'Preview unavailable — the price is still checked when you save.', tone: 'hint' };
        } else if (quote) {
          status = { text: packPreviewLabel(quote), tone: quote.error ? 'error' : 'hint' };
        } else {
          status = { text: 'Checking…', tone: 'hint' };
        }

        return (
          <div key={row.key} className={styles.pack}>
            <div className={styles.row}>
              <input
                aria-label={`${label} lesson length (min)`}
                type="number"
                min={15}
                step={1}
                className={adminStyles.input}
                placeholder="Minutes"
                value={row.sessionDurationMinutes}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'sessionDurationMinutes', e.target.value)}
              />
              <input
                aria-label={`${label} sessions`}
                type="number"
                min={2}
                step={1}
                className={adminStyles.input}
                placeholder="Sessions"
                value={row.quantity}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'quantity', e.target.value)}
              />
              <input
                aria-label={`${label} price ($)`}
                type="number"
                min={0}
                step={0.01}
                className={adminStyles.input}
                placeholder="Price ($)"
                value={row.price}
                disabled={disabled}
                onChange={(e) => setRow(row.key, 'price', e.target.value)}
              />
              <button
                type="button"
                className={adminStyles.btnSecondary}
                aria-label={`Remove ${label.toLowerCase()}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((candidate) => candidate.key !== row.key))}
              >
                Remove
              </button>
            </div>
            {status ? (
              <div
                className={status.tone === 'error' ? adminStyles.errorText : adminStyles.formHint}
                data-testid={`pack-status-${index + 1}`}
              >
                {status.text}
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        className={adminStyles.btnSecondary}
        disabled={disabled}
        onClick={() => onChange([...rows, emptyPackRow(defaultMinutes)])}
      >
        Add pack
      </button>
    </div>
  );
}
