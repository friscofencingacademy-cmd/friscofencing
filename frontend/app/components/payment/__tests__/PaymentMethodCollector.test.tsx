import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import PaymentMethodCollector from '../PaymentMethodCollector';
import type { PaymentConfig } from '../../../../lib/types';

// The Stripe SDK is the named external-SDK exception (docs/TESTING_STRATEGY.md):
// its card iframe cannot render in jsdom. GET /payments/config goes through MSW.
jest.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ createPaymentMethod: jest.fn() }),
  useElements: () => ({ getElement: () => ({}) }),
}));

const STRIPE_CONFIG: PaymentConfig = { provider: 'stripe', stripe: { publishableKey: 'pk_test_123' } };
const SQUARE_CONFIG: PaymentConfig = {
  provider: 'square',
  square: { applicationId: 'sandbox-sq0idb-app', locationId: 'L1', environment: 'sandbox' },
};

const server = setupServer(http.get('*/payments/config', () => HttpResponse.json(STRIPE_CONFIG)));

let user: ReturnType<typeof userEvent.setup>;

beforeAll(() => server.listen({ onUnhandledRequest }));
beforeEach(() => {
  user = userEvent.setup();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('PaymentMethodCollector', () => {
  it('shows a loading state, then the active provider\'s card form (Stripe)', async () => {
    render(<PaymentMethodCollector onSaved={jest.fn()} submitLabel="Add Card" />);

    expect(screen.getByText('Loading card form...')).toBeInTheDocument();
    expect(await screen.findByTestId('card-element')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Card' })).toBeInTheDocument();
  });

  it('shows an inline load error with a retry when the config cannot be loaded, and recovers', async () => {
    server.use(http.get('*/payments/config', () => HttpResponse.json({ message: 'Something went wrong' }, { status: 500 })));

    render(<PaymentMethodCollector onSaved={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong — please try again.');
    expect(screen.queryByTestId('card-element')).not.toBeInTheDocument();

    server.use(http.get('*/payments/config', () => HttpResponse.json(STRIPE_CONFIG)));
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('card-element')).toBeInTheDocument();
  });

  it('says plainly that card entry is unavailable for a provider with no form yet — never a blank page', async () => {
    server.use(http.get('*/payments/config', () => HttpResponse.json(SQUARE_CONFIG)));

    render(<PaymentMethodCollector onSaved={jest.fn()} />);

    expect(await screen.findByText(/Card entry is not available yet for this payment provider/)).toBeInTheDocument();
    expect(screen.queryByTestId('card-element')).not.toBeInTheDocument();
  });
});
