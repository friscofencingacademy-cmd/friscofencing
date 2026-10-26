'use client';

import { useState, type FormEvent } from 'react';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

import { savePaymentMethod } from '../../../../lib/services/parent';
import type { PaymentMethodInfo } from '../../../../lib/types';
import Button from '../../ui/Button/Button';
import Card from '../../ui/Card/Card';
import Alert from '../../ui/Alert/Alert';
import styles from '../../ui/shared.module.css';

export interface StripeCardFormProps {
  publishableKey: string;
  onSaved: (paymentMethod: PaymentMethodInfo) => void;
  submitLabel?: string;
}

// One Stripe.js instance per publishable key for the life of the page —
// Stripe's own recommended pattern (loadStripe must not run on every render).
const stripePromises = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  let promise = stripePromises.get(publishableKey);

  if (!promise) {
    promise = loadStripe(publishableKey);
    stripePromises.set(publishableKey, promise);
  }

  return promise;
}

// The Stripe card form — rendered only by PaymentMethodCollector when Stripe
// is the active provider. This folder (components/payment/) is the only place
// a provider SDK may be imported (lib/__tests__/guards/paymentSdkBoundaryGuard.test.ts).
// Owns its own <Elements> provider, so callers know nothing about Stripe.
export default function StripeCardForm({ publishableKey, onSaved, submitLabel = 'Save Card' }: StripeCardFormProps) {
  return (
    <Elements stripe={stripeFor(publishableKey)}>
      <StripeCardFields onSaved={onSaved} submitLabel={submitLabel} />
    </Elements>
  );
}

function StripeCardFields({ onSaved, submitLabel }: Omit<StripeCardFormProps, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);

    if (!cardElement) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (result.error) {
        setError(result.error.message || 'Failed to process card. Please try again.');
        return;
      }

      const saved = await savePaymentMethod(result.paymentMethod.id);

      if (saved.status === 'error') {
        setError(saved.message);
        return;
      }

      onSaved(saved.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Card Details</label>
          <div
            style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-white)',
            }}
          >
            <CardElement
              options={{
                style: { base: { fontFamily: 'inherit', fontSize: '16px', color: '#1B1A17' } },
              }}
            />
          </div>
        </div>
        {error ? (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Alert variant="error">{error}</Alert>
          </div>
        ) : null}
        <Button type="submit" disabled={!stripe || submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </Button>
      </form>
    </Card>
  );
}
