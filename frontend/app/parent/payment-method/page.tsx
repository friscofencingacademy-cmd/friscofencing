'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';

import api from '../../../lib/api';
import stripePromise from '../../../lib/stripe';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

interface SavedPaymentMethod {
  _id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
}

interface CardFormProps {
  onSaved: (paymentMethod: SavedPaymentMethod) => void;
}

function CardForm({ onSaved }: CardFormProps) {
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

      const res = await api.post<{ paymentMethod: SavedPaymentMethod }>('/payment-methods', {
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
          {submitting ? 'Saving...' : 'Save Card'}
        </Button>
      </form>
    </Card>
  );
}

function PaymentMethodPageContent() {
  const [paymentMethod, setPaymentMethod] = useState<SavedPaymentMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchPaymentMethod() {
      setLoading(true);
      try {
        const res = await api.get<{ paymentMethod: SavedPaymentMethod | null }>(
          '/payment-methods/mine'
        );

        if (isMounted) {
          setPaymentMethod(res.data.paymentMethod);
        }
      } catch (err) {
        if (isMounted) {
          setLoadError('Failed to load your saved card.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchPaymentMethod();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSaved = useCallback((saved: SavedPaymentMethod) => {
    setPaymentMethod(saved);
    setIsEditing(false);
  }, []);

  if (loading) {
    return (
      <main>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Payment Method</h1>
        </div>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Payment Method</h1>
      </div>

      {loadError ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{loadError}</Alert>
        </div>
      ) : null}

      {paymentMethod && !isEditing ? (
        <Card>
          <p>
            Card on file: {paymentMethod.cardBrand} ending in {paymentMethod.cardLast4}, expires{' '}
            {paymentMethod.cardExpMonth}/{paymentMethod.cardExpYear}
          </p>
          <Button type="button" onClick={() => setIsEditing(true)}>
            Update card
          </Button>
        </Card>
      ) : (
        <Elements stripe={stripePromise}>
          <CardForm onSaved={handleSaved} />
        </Elements>
      )}
    </main>
  );
}

export default function PaymentMethodPage() {
  return <PaymentMethodPageContent />;
}
