import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PaymentMethodPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// `@stripe/react-stripe-js`'s CardElement renders into a cross-origin iframe
// that jsdom cannot simulate at all — there is no way to "type a card
// number" into it in a jsdom test. This mocks the third-party Stripe SDK
// directly (not our own service layer, which is what the project's usual
// network-boundary mocking rule is about): useStripe() is stubbed so the
// test controls createPaymentMethod's resolved value, and
// CardElement/Elements are trivial passthroughs. The real POST
// /payment-methods call below still goes through MSW as normal.
const createPaymentMethodMock = jest.fn();

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ createPaymentMethod: createPaymentMethodMock }),
  useElements: () => ({ getElement: () => ({}) }),
}));

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Par',
  lastName: 'Ent',
  email: 'parent@example.com',
};

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
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })),
  http.post('*/payment-methods', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json({ paymentMethod: SAVED_CARD }, { status: 201 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  createPaymentMethodMock.mockReset();
  postPayload = null;
});
afterAll(() => server.close());

function renderPaymentMethodPage() {
  return render(
    <AuthProvider>
      <PaymentMethodPage />
    </AuthProvider>
  );
}

describe('PaymentMethodPage', () => {
  it('shows the card-entry form when no card is saved yet, then the "card on file" state after a successful save', async () => {
    createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });

    renderPaymentMethodPage();

    expect(await screen.findByTestId('card-element')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ stripePaymentMethodId: STRIPE_PAYMENT_METHOD.id });
    });

    expect(
      await screen.findByText(/card on file: visa ending in 4242, expires 8\/2030/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update card/i })).toBeInTheDocument();
  });

  it('shows the "card on file" state immediately when a card already exists on mount', async () => {
    server.use(
      http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: SAVED_CARD }))
    );

    renderPaymentMethodPage();

    expect(
      await screen.findByText(/card on file: visa ending in 4242, expires 8\/2030/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('card-element')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /update card/i }));

    expect(await screen.findByTestId('card-element')).toBeInTheDocument();
  });

  it("shows an inline error when Stripe's createPaymentMethod itself fails, without crashing", async () => {
    createPaymentMethodMock.mockResolvedValue({
      error: { message: 'Your card number is invalid.' },
    });

    renderPaymentMethodPage();

    await screen.findByTestId('card-element');

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Your card number is invalid.');
    });

    // Never called our own API since Stripe rejected the card first.
    expect(postPayload).toBeNull();
  });

  it('shows an inline error when the backend POST /payment-methods call fails, without crashing', async () => {
    createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });
    server.use(
      http.post('*/payment-methods', () =>
        HttpResponse.json({ message: 'Failed to save payment method' }, { status: 500 })
      )
    );

    renderPaymentMethodPage();

    await screen.findByTestId('card-element');

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save payment method');
    });
  });
});
