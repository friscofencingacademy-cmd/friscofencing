import { useDebouncedValue } from './useDebouncedValue';
import { useLoadState } from './useLoadState';
import { fetchContractPreview } from '../services/coachContracts';
import { packPreviewLabel } from '../privateLessons';
import type { ContractPreview, PackQuoteRow, PrivateLessonPack, PrivateLessonPackDraft, SessionPriceRow } from '../types';

// The coach-contract editor's live preview, in ONE place
// (docs/plans/coach-pack-pricing-plan.md §8 V7): the pack rows' shape, the
// debounce, the POST /coach-contracts/preview call, each row's status line,
// the lesson prices shown under the rate, and whether Save is allowed. The
// create and edit dialogs both use it; PackEditor only renders rows.
//
// No price arithmetic here: every figure and every refusal message is the
// backend's. The only local check is completeness (all three fields filled).

export const CONTRACT_PREVIEW_DEBOUNCE_MS = 400;

// A pack row as typed. `key` is a stable React key.
export interface PackEditorRow {
  key: string;
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
    sessionDurationMinutes: String(pack.sessionDurationMinutes),
    quantity: String(pack.quantity),
    price: String(pack.price),
  }));
}

export function emptyPackRow(defaultMinutes = ''): PackEditorRow {
  return { key: nextKey(), sessionDurationMinutes: defaultMinutes, quantity: '', price: '' };
}

export function isCompletePackRow(row: PackEditorRow): boolean {
  return row.sessionDurationMinutes.trim() !== '' && row.quantity.trim() !== '' && row.price.trim() !== '';
}

// What is sent to the backend — the typed values as numbers, nothing derived.
export function packDraftsFromRows(rows: PackEditorRow[]): PrivateLessonPackDraft[] {
  return rows.map((row) => ({
    sessionDurationMinutes: Number(row.sessionDurationMinutes),
    quantity: Number(row.quantity),
    price: Number(row.price),
  }));
}

// A typed rate/length as a usable number, or null.
export function parseNonNegative(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
}

export interface PackRowStatus {
  text: string;
  tone: 'hint' | 'error';
}

export interface ContractPreviewState {
  // Lesson prices at the typed rate, or null while there is none to show.
  sessionPrices: SessionPriceRow[] | null;
  statusFor: (row: PackEditorRow) => PackRowStatus;
  // Blocked while a row is incomplete, while the preview is in flight, or
  // while the backend refuses a row. A FAILED preview does not block (D9a):
  // the save's own 400 is the rule.
  canSave: boolean;
  previewFailed: boolean;
}

export function useContractPreview({
  studentBillingRate,
  sessionDurationMinutes,
  rows,
  coachId,
}: {
  studentBillingRate: number | null;
  sessionDurationMinutes: number | null;
  rows: PackEditorRow[];
  coachId?: string;
}): ContractPreviewState {
  const completeRows = rows.filter(isCompletePackRow);
  // The request as a string, so it compares by value across renders.
  const request =
    studentBillingRate === null
      ? null
      : JSON.stringify({
          studentBillingRate,
          sessionDurationMinutes,
          packs: packDraftsFromRows(completeRows),
          ...(coachId ? { coachId } : {}),
        });
  const debouncedRequest = useDebouncedValue(request, CONTRACT_PREVIEW_DEBOUNCE_MS);

  const preview = useLoadState<{ request: string | null; result: ContractPreview | null }>(
    async () =>
      debouncedRequest === null
        ? { request: null, result: null }
        : { request: debouncedRequest, result: await fetchContractPreview(JSON.parse(debouncedRequest)) },
    [debouncedRequest]
  );

  const fresh = preview.data !== null && preview.data.request === request && !preview.isLoading;
  const previewFailed = !preview.isLoading && preview.error !== null && debouncedRequest === request;
  const result = fresh && preview.data ? preview.data.result : null;

  // The preview for each complete row, in order (the request sent only those).
  const quoteByKey = new Map<string, PackQuoteRow>();
  if (result) {
    completeRows.forEach((row, index) => {
      const quote = result.packs[index];
      if (quote) quoteByKey.set(row.key, quote);
    });
  }

  const anyIncomplete = rows.some((row) => !isCompletePackRow(row));
  const anyRefused = [...quoteByKey.values()].some((quote) => quote.error !== null);
  const pending = request !== null && !fresh && !previewFailed;
  const canSave = !anyIncomplete && !anyRefused && !pending;

  function statusFor(row: PackEditorRow): PackRowStatus {
    if (!isCompletePackRow(row)) return { text: 'Fill in the lesson length, sessions and price.', tone: 'hint' };
    if (studentBillingRate === null) return { text: 'Set the hourly rate to see this pack’s price check.', tone: 'hint' };
    if (previewFailed) return { text: 'Preview unavailable — the price is still checked when you save.', tone: 'hint' };
    const quote = quoteByKey.get(row.key);
    if (!quote) return { text: 'Checking…', tone: 'hint' };
    return { text: packPreviewLabel(quote), tone: quote.error ? 'error' : 'hint' };
  }

  return { sessionPrices: result ? result.sessionPrices : null, statusFor, canSave, previewFailed };
}
