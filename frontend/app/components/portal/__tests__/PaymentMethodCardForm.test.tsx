import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PaymentMethodCardForm from '../PaymentMethodCardForm';

// Same Stripe-mocking approach as payment-method/__tests__/page.test.tsx —
// CardElement renders into a cross-origin iframe jsdom can't simulate, so
// the third-party SDK is stubbed directly (not our own service layer). The
// real POST /payment-methods call still goes through MSW as normal.
const createPaymentMethodMock = jest.fn();

jest.mock('@stripe/react-stripe-js', () => ({
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ createPaymentMethod: createPaymentMethodMock }),
  useElements: () => ({ getElement: () => ({}) }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

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

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  createPaymentMethodMock.mockReset();
  postPayload = null;
});
afterAll(() => server.close());

describe('PaymentMethodCardForm', () => {
  it('saves the card and calls onSaved with the real backend response', async () => {
    createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });
    const onSaved = jest.fn();

    render(
      <Wrapper>
        <PaymentMethodCardForm onSaved={onSaved} />
      </Wrapper>
    );

    expect(screen.getByTestId('card-element')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ stripePaymentMethodId: STRIPE_PAYMENT_METHOD.id });
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(SAVED_CARD);
    });
  });

  it('uses a custom submitLabel when provided, defaulting to "Save Card" otherwise', () => {
    const { rerender } = render(
      <Wrapper>
        <PaymentMethodCardForm onSaved={jest.fn()} />
      </Wrapper>
    );
    expect(screen.getByRole('button', { name: 'Save Card' })).toBeInTheDocument();

    rerender(
      <Wrapper>
        <PaymentMethodCardForm onSaved={jest.fn()} submitLabel="Add Card" />
      </Wrapper>
    );
    expect(screen.getByRole('button', { name: 'Add Card' })).toBeInTheDocument();
  });

  it("shows an inline error when Stripe's createPaymentMethod itself fails, and never calls onSaved", async () => {
    createPaymentMethodMock.mockResolvedValue({ error: { message: 'Your card number is invalid.' } });
    const onSaved = jest.fn();

    render(
      <Wrapper>
        <PaymentMethodCardForm onSaved={onSaved} />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

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
      <Wrapper>
        <PaymentMethodCardForm onSaved={onSaved} />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save payment method');
    });

    expect(onSaved).not.toHaveBeenCalled();
  });
});
