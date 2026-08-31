import api from '../api';
import type {
  AdminSubscriptionListResponse,
  AdminSubscriptionRow,
  ChargePreview,
  ChargeResult,
} from '../types';
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

// Manual Charge button (docs/plans/manual-charge-and-pdf-invoice-plan.md,
// PR 1) — superadmin only. The preview is read-only (no Stripe call on the
// backend); the charge itself calls the exact same renewOne/retryOne the
// unscheduled `npm run renewals` job uses.
export async function fetchChargePreview(id: string): Promise<MutationResult<ChargePreview>> {
  try {
    const res = await api.get<ChargePreview>(`/subscriptions/${id}/charge-preview`);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to load the charge preview.') };
  }
}

// `period` (docs/plans/payment-airtight-plan.md D4) — 'full' | 'prorated',
// defaults to 'full' server-side when omitted.
export async function chargeSubscription(
  id: string,
  period: 'full' | 'prorated' = 'full'
): Promise<MutationResult<ChargeResult>> {
  try {
    const res = await api.post<ChargeResult>(`/subscriptions/${id}/charge`, { period });
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to charge the subscription.') };
  }
}

// The manual/offline payment path (D5) — admin-entered amount + required
// note, no Stripe call.
export async function recordManualPayment(
  id: string,
  payload: { amount: number; note: string; period: 'full' | 'prorated' }
): Promise<MutationResult<ChargeResult>> {
  try {
    const res = await api.post<ChargeResult>(`/subscriptions/${id}/record-payment`, payload);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to record the payment.') };
  }
}
