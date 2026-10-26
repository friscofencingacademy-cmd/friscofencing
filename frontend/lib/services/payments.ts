import api from '../api';
import type { PaymentConfig } from '../types';

// The active payment provider's browser configuration — a QUERY: it throws on
// failure (services contract, ./shared.ts), so callers pair it with useLoadState.
export async function fetchPaymentConfig(): Promise<PaymentConfig> {
  const res = await api.get<PaymentConfig>('/payments/config');
  return res.data;
}
