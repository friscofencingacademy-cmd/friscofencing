'use client';

import { useCallback, useEffect, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';

import api from '../../../lib/api';
import stripePromise from '../../../lib/stripe';
import type { PaymentMethodInfo } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import PaymentMethodCardForm from '../../components/portal/PaymentMethodCardForm';
import styles from '../../components/ui/shared.module.css';

function PaymentMethodPageContent() {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchPaymentMethod() {
      setLoading(true);
      try {
        const res = await api.get<{ paymentMethod: PaymentMethodInfo | null }>(
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

  const handleSaved = useCallback((saved: PaymentMethodInfo) => {
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
          <PaymentMethodCardForm onSaved={handleSaved} />
        </Elements>
      )}
    </main>
  );
}

export default function PaymentMethodPage() {
  return <PaymentMethodPageContent />;
}
