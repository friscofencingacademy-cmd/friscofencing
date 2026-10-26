import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../../test-utils/msw';

import type { loadStripe } from '@stripe/stripe-js';

import StripeCardForm from '../StripeCardForm';

// CardElement renders into a cross-origin iframe jsdom can't simulate, so the
// third-party SDK is stubbed directly (docs/TESTING_STRATEGY.md's named
// external-SDK exception — not our own service layer). The real
// POST /payment-methods call still goes through MSW as normal.
const createPaymentMethodMock = jest.fn();
// Typed from the real function, so an SDK signature change fails compilation.
const loadStripeMock = jest.fn<ReturnType<typeof loadStripe>, Parameters<typeof loadStripe>>(() => Promise.resolve(null));

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: (...args: Parameters<typeof loadStripe>) => loadStripeMock(...args),
}));

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ createPaymentMethod: createPaymentMethodMock }),
  useElements: () => ({ getElement: () => ({}) }),
}));

const PUBLISHABLE_KEY = 'pk_test_from_backend_config';

const SAVED_CARD = {
  _id: 'pm-1',
  cardBrand: 'visa',
  cardLast4: '4242',
  cardExpMonth: 8,
  cardExpYear: 2030,
};

const STRIPE_PAYMENT_METHOD = { id: 'pm_stripe_test_123' };

let postPayload: unknown = null;

const server = setupServer(
  http.post('*/payment-methods', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json({ paymentMethod: SAVED_CARD }, { status: 201 });
  })
);

let user: ReturnType<typeof userEvent.setup>;

beforeAll(() => server.listen({ onUnhandledRequest }));
beforeEach(() => {
  user = userEvent.setup();
});
afterEach(() => {
  server.resetHandlers();
  createPaymentMethodMock.mockReset();
  postPayload = null;
});
afterAll(() => server.close());

describe('StripeCardForm', () => {
  it('saves the card and calls onSaved with the real backend response', async () => {
    createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });
    const onSaved = jest.fn();

    render(
      <StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={onSaved} />
    );

    expect(screen.getByTestId('card-element')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ paymentMethodToken: STRIPE_PAYMENT_METHOD.id });
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(SAVED_CARD);
    });
  });

  it('uses a custom submitLabel when provided, defaulting to "Save Card" otherwise', () => {
    const { rerender } = render(
      <StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Save Card' })).toBeInTheDocument();

    rerender(
      <StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={jest.fn()} submitLabel="Add Card" />
    );
    expect(screen.getByRole('button', { name: 'Add Card' })).toBeInTheDocument();
  });

  it("shows an inline error when Stripe's createPaymentMethod itself fails, and never calls onSaved", async () => {
    createPaymentMethodMock.mockResolvedValue({ error: { message: 'Your card number is invalid.' } });
    const onSaved = jest.fn();

    render(
      <StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={onSaved} />
    );

    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Your card number is invalid.');
    });

    expect(postPayload).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows an inline error when the backend POST /payment-methods call fails, and never calls onSaved', async () => {
    createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });
    server.use(
      http.post('*/payment-methods', () =>
        HttpResponse.json({ message: 'Failed to save payment method' }, { status: 500 })
      )
    );
    const onSaved = jest.fn();

    render(
      <StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={onSaved} />
    );

    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save payment method');
    });

    expect(onSaved).not.toHaveBeenCalled();
  });

  it('loads Stripe.js once per publishable key, with the key the backend served', () => {
    render(<StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={jest.fn()} />);
    render(<StripeCardForm publishableKey={PUBLISHABLE_KEY} onSaved={jest.fn()} />);

    expect(loadStripeMock.mock.calls.filter(([key]) => key === PUBLISHABLE_KEY)).toHaveLength(1);
  });
});
