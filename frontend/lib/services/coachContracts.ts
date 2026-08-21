import api from '../api';
import type { CoachContract } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

export async function fetchCoachContracts(coachId?: string): Promise<CoachContract[]> {
  const res = await api.get<{ contracts: CoachContract[] }>('/coach-contracts', {
    params: coachId ? { coachId } : undefined,
  });
  return res.data.contracts;
}

export async function createCoachContract(data: {
  coachId: string;
  studentBillingRate: number;
  coachCompensationRate: number;
  sessionDurationMinutes?: number;
  notes?: string;
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
