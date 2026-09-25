import api from '../api';
import type { CoachContract, CoachContractRevision, ContractPreview, PrivateLessonPackDraft } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// Coach contracts are versioned (docs/plans/coach-pack-pricing-plan.md §8):
// create = a coach's first current contract, revise = Edit (ends the current
// version and starts a new one), deactivate = end it with no successor.

export async function fetchCoachContracts(coachId?: string): Promise<CoachContract[]> {
  const res = await api.get<{ contracts: CoachContract[] }>('/coach-contracts', {
    params: coachId ? { coachId } : undefined,
  });
  return res.data.contracts;
}

export interface CoachContractTerms {
  studentBillingRate: number;
  coachCompensationRate: number;
  sessionDurationMinutes?: number;
  notes?: string;
  privateLessonPacks?: PrivateLessonPackDraft[];
}

export async function createCoachContract(
  data: CoachContractTerms & { coachId: string }
): Promise<MutationResult<CoachContract>> {
  try {
    const res = await api.post<{ contract: CoachContract }>('/coach-contracts', data);
    return { status: 'success', data: res.data.contract };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create coach contract.') };
  }
}

// Edit: the backend keeps the current version as read-only history and
// starts a new one with these terms.
export async function reviseCoachContract(
  id: string,
  data: CoachContractTerms
): Promise<MutationResult<CoachContractRevision>> {
  try {
    const res = await api.post<CoachContractRevision>(`/coach-contracts/${id}/revisions`, data);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to save the contract.') };
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

// The editor's live preview (plan D9a, §8 V6) — a query: throws on failure.
// Writes nothing; every price and every error message is the backend's own.
export async function fetchContractPreview(data: {
  studentBillingRate: number;
  sessionDurationMinutes: number | null;
  packs: PrivateLessonPackDraft[];
  coachId?: string;
}): Promise<ContractPreview> {
  const res = await api.post<ContractPreview>('/coach-contracts/preview', data);
  return res.data;
}
