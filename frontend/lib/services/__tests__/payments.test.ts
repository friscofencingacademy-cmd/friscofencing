import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../test-utils/msw';

import { fetchPaymentConfig } from '../payments';
import type { PaymentConfig } from '../../types';

// docs/TESTING_STRATEGY.md's error-handling contract: a query throws on failure.

const STRIPE_CONFIG: PaymentConfig = { provider: 'stripe', stripe: { publishableKey: 'pk_test_123' } };
const SQUARE_CONFIG: PaymentConfig = {
  provider: 'square',
  square: { applicationId: 'sandbox-sq0idb-app', locationId: 'L1', environment: 'sandbox' },
};

const server = setupServer(http.get('*/payments/config', () => HttpResponse.json(STRIPE_CONFIG)));

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('payments service', () => {
  it('fetchPaymentConfig resolves the server response verbatim', async () => {
    await expect(fetchPaymentConfig()).resolves.toEqual(STRIPE_CONFIG);
  });

  it('fetchPaymentConfig resolves a Square config verbatim too', async () => {
    server.use(http.get('*/payments/config', () => HttpResponse.json(SQUARE_CONFIG)));

    await expect(fetchPaymentConfig()).resolves.toEqual(SQUARE_CONFIG);
  });

  it('fetchPaymentConfig rejects on a server error — a query never resolves a failure', async () => {
    server.use(http.get('*/payments/config', () => HttpResponse.json({ message: 'Something went wrong' }, { status: 500 })));

    await expect(fetchPaymentConfig()).rejects.toBeTruthy();
  });
});
