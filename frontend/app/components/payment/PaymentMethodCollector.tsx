'use client';

import { fetchPaymentConfig } from '../../../lib/services/payments';
import { getErrorMessage, useLoadState } from '../../../lib/hooks/useLoadState';
import type { PaymentMethodInfo } from '../../../lib/types';
import Card from '../ui/Card/Card';
import Alert from '../ui/Alert/Alert';
import LoadError from '../ui/LoadError/LoadError';
import StripeCardForm from './stripe/StripeCardForm';

export interface PaymentMethodCollectorProps {
  onSaved: (paymentMethod: PaymentMethodInfo) => void;
  submitLabel?: string;
}

// The one card-entry component pages render (docs/plans/payment-provider-port-plan.md
// D10). It asks the backend which payment provider is active and renders that
// provider's own card form — pages never know or import a provider. Each form
// tokenizes the card in the provider's secure iframe and saves it through
// POST /payment-methods.
export default function PaymentMethodCollector({ onSaved, submitLabel }: PaymentMethodCollectorProps) {
  const { data: config, error, isLoading, retry } = useLoadState(fetchPaymentConfig, []);

  if (isLoading) {
    return (
      <Card>
        <p>Loading card form...</p>
      </Card>
    );
  }

  if (error || !config) {
    return <LoadError message={getErrorMessage(error)} onRetry={retry} />;
  }

  if (config.provider === 'stripe') {
    return <StripeCardForm publishableKey={config.stripe.publishableKey} onSaved={onSaved} submitLabel={submitLabel} />;
  }

  return (
    <Alert variant="error">
      Card entry is not available yet for this payment provider. Please contact the academy.
    </Alert>
  );
}
