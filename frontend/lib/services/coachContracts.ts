import api from '../api';
import type { CoachContract, PackQuoteRow, PrivateLessonPackDraft } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

export async function fetchCoachContracts(coachId?: string): Promise<CoachContract[]> {
  const res = await api.get<{ contracts: CoachContract[] }>('/coach-contracts', {
    params: coachId ? { coachId } : undefined,
  });
  return res.data.contracts;
}

// `privateLessonPacks` omitted = the coach's current packs carry over
// (backend); the admin dialog always sends the list it shows.
export async function createCoachContract(data: {
  coachId: string;
  studentBillingRate: number;
  coachCompensationRate: number;
  sessionDurationMinutes?: number;
  notes?: string;
  privateLessonPacks?: PrivateLessonPackDraft[];
}): Promise<MutationResult<CoachContract>> {
  try {
    const res = await api.post<{ contract: CoachContract }>('/coach-contracts', data);
    return { status: 'success', data: res.data.contract };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create coach contract.') };
  }
}

export async function deactivateCoachContract(id: string): Promise<MutationResult<CoachContract>> {
  try {
    const res = await api.post<{ contract: CoachContract }>(`/coach-contracts/${id}/deactivate`);
    return { status: 'success', data: res.data.contract };
  } catch (err) {
    return {
      status: 'error',
      message: extractErrorMessage(err, 'Failed to deactivate coach contract.'),
    };
  }
}

// Replace the active contract's packs (docs/plans/coach-pack-pricing-plan.md
// D7). Send a saved pack's `_id` back to keep it; the backend keeps the id
// only when nothing about the pack changed.
export async function updateCoachContractPacks(
  id: string,
  privateLessonPacks: PrivateLessonPackDraft[]
): Promise<MutationResult<CoachContract>> {
  try {
    const res = await api.put<{ contract: CoachContract }>(`/coach-contracts/${id}/packs`, { privateLessonPacks });
    return { status: 'success', data: res.data.contract };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to save packs.') };
  }
}

// The pack editor's live preview (plan D9a) — a query: throws on failure.
// Writes nothing; every figure and every error message is the backend's own.
export async function fetchPackQuotes(data: {
  studentBillingRate: number;
  packs: PrivateLessonPackDraft[];
}): Promise<PackQuoteRow[]> {
  const res = await api.post<{ quotes: PackQuoteRow[] }>('/coach-contracts/pack-quotes', data);
  return res.data.quotes;
}
