import api from '../api';
import type { AdminSubscriptionListResponse, AdminSubscriptionRow } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

export type AdminSubscriptionStatusFilter = 'active' | 'pending_cancel' | 'cancelled';

export interface FetchSubscriptionsParams {
  status?: AdminSubscriptionStatusFilter;
  q?: string;
  page?: number;
  limit?: number;
}

// QUERY — throws on failure, pairs with useLoadState (see
// docs/TESTING_STRATEGY.md's error-handling contract).
export async function fetchSubscriptions(
  params: FetchSubscriptionsParams = {}
): Promise<AdminSubscriptionListResponse> {
  const res = await api.get<AdminSubscriptionListResponse>('/subscriptions', { params });
  return res.data;
}

// MUTATIONS — never throw; resolve to a MutationResult.

export async function changeSubscriptionSchedule(
  id: string,
  newScheduleId: string
): Promise<MutationResult<AdminSubscriptionRow>> {
  try {
    const res = await api.patch<{ subscription: AdminSubscriptionRow }>(
      `/subscriptions/${id}/schedule`,
      { newScheduleId }
    );
    return { status: 'success', data: res.data.subscription };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to change schedule.') };
  }
}

export async function cancelSubscriptionAdmin(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.post(`/subscriptions/${id}/cancel`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to cancel subscription.') };
  }
}

export async function reactivateSubscription(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.post(`/subscriptions/${id}/reactivate`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return {
      status: 'error',
      message: extractErrorMessage(err, 'Failed to reactivate subscription.'),
    };
  }
}
