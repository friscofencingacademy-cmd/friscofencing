import api from '../api';
import type { Evaluation } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

export async function createEvaluation(data: {
  studentId: string;
  groupClassSessionId: string;
  assignedLevelId: string;
  notes: string;
}): Promise<MutationResult<Evaluation>> {
  try {
    const res = await api.post<{ evaluation: Evaluation }>('/evaluations', data);
    return { status: 'success', data: res.data.evaluation };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to save evaluation.') };
  }
}
