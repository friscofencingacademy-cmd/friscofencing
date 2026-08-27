'use client';

import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js';

import api from '../../../lib/api';
import type { PaymentMethodInfo } from '../../../lib/types';
import Button from '../ui/Button/Button';
import Card from '../ui/Card/Card';
import Alert from '../ui/Alert/Alert';
import styles from '../ui/shared.module.css';

export interface PaymentMethodCardFormProps {
  onSaved: (paymentMethod: PaymentMethodInfo) => void;
  submitLabel?: string;
}

// The one Stripe CardElement integration in the app — extracted here so
// /parent/payment-method and the register wizard's inline "add a card"
// step both call the exact same save path (stripe.createPaymentMethod ->
// POST /payment-methods) rather than each having their own copy. Must be
// rendered inside a Stripe <Elements> provider — callers own that wrapping,
// since each page mounts it at a different point in its own tree.
export default function PaymentMethodCardForm({ onSaved, submitLabel = 'Save Card' }: PaymentMethodCardFormProps) {
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

      const res = await api.post<{ paymentMethod: PaymentMethodInfo }>('/payment-methods', {
        stripePaymentMethodId: result.paymentMethod.id,
      });

      onSaved(res.data.paymentMethod);
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to save card. Please try again.';
      setError(message);
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
