import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

// Same Stripe-mocking approach as payment-method/__tests__/page.test.tsx —
// CardElement renders into a cross-origin iframe jsdom can't simulate, so
// the third-party SDK is stubbed directly. The real POST /payment-methods
// call still goes through MSW as normal.
const createPaymentMethodMock = jest.fn();

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => ({ createPaymentMethod: createPaymentMethodMock }),
  useElements: () => ({ getElement: () => ({}) }),
}));

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

const LEVEL_BEGINNER = { _id: 'level-1', name: 'Beginner' };
const LEVEL_ADVANCED = { _id: 'level-2', name: 'Advanced' };

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil', levelId: LEVEL_BEGINNER._id, locationId: 'loc-1', capacity: 10 };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee', levelId: LEVEL_ADVANCED._id, locationId: 'loc-1', capacity: 10 };

const SCHEDULE_A = { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] };
const SCHEDULE_B = { _id: 'sched-2', classId: 'class-2', coachId: 'coach-1', dayOfWeek: 4, startTime: '18:00', endTime: '19:00', students: [] };

const PRICE_BEGINNER = { _id: 'price-1', levelId: LEVEL_BEGINNER._id, monthlyFee: 150 };

const SAVED_PAYMENT_METHOD = { _id: 'pm-1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 8, cardExpYear: 2030 };
const STRIPE_PAYMENT_METHOD = { id: 'pm_stripe_test_123' };

const DEFAULT_PREVIEW = {
  monthlyFee: 150,
  chargeAmount: 150,
  totalChargeAmount: 150,
  siblingDiscountApplied: false,
  siblingDiscountAmount: 0,
  siblingDiscountReason: null,
  registrationFeeCharged: 0,
  registrationFeeWaived: false,
  registrationFeeReason: null,
  prorated: false,
  totalClassDays: null,
  remainingClassDays: null,
  dailyRate: null,
  periodEnd: '2026-09-26T00:00:00.000Z',
};

let postRegistrationPayload: unknown = null;
let postPaymentMethodPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B] })),
  http.get('*/prices', () => HttpResponse.json({ prices: [PRICE_BEGINNER] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [LEVEL_BEGINNER, LEVEL_ADVANCED] })),
  http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: SAVED_PAYMENT_METHOD })),
  http.get('*/registrations/preview', () => HttpResponse.json(DEFAULT_PREVIEW)),
  http.post('*/registrations', async ({ request }) => {
    postRegistrationPayload = await request.json();
    return HttpResponse.json(
      {
        registration: { _id: 'reg-1' },
        subscription: { _id: 'sub-1' },
        chargeAmount: 150,
        totalChargeAmount: 150,
        paymentIntentStatus: 'succeeded',
        registrationFeeCharged: 0,
        registrationFeeWaived: false,
        registrationFeeReason: null,
        prorated: false,
        totalClassDays: null,
        remainingClassDays: null,
        dailyRate: null,
        periodEnd: '2026-09-26T00:00:00.000Z',
      },
      { status: 201 }
    );
  }),
  http.post('*/payment-methods', async ({ request }) => {
    postPaymentMethodPayload = await request.json();
    return HttpResponse.json({ paymentMethod: SAVED_PAYMENT_METHOD }, { status: 201 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  postRegistrationPayload = null;
  postPaymentMethodPayload = null;
  mockSearchParams = new URLSearchParams();
  createPaymentMethodMock.mockReset();
});
afterAll(() => server.close());

function renderRegisterPage() {
  return render(
    <ParentPortalProvider>
      <RegisterPage />
    </ParentPortalProvider>
  );
}

// Selecting a child auto-advances straight to the Level step (no separate
// "Continue" click) — this alone replaces what used to be a two-step
// Who -> click Continue -> Class dance.
async function selectChildAndReachLevelStep() {
  fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
  await screen.findByRole('radiogroup', { name: /select a level/i });
}

async function goToPayableState() {
  await selectChildAndReachLevelStep();
  fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));
  const timePill = await screen.findByRole('radio', { name: /wednesday 4:00 pm-5:00 pm/i });
  fireEvent.click(timePill);
  await waitFor(() => expect(timePill).toHaveAttribute('aria-checked', 'true'));
}

describe('RegisterPage wizard', () => {
  it('selecting a child auto-advances to the Level step — no explicit "Continue" click needed', async () => {
    renderRegisterPage();

    // Before selecting anyone, the Level picker isn't rendered at all.
    expect(screen.queryByRole('radiogroup', { name: /select a level/i })).not.toBeInTheDocument();

    await selectChildAndReachLevelStep();

    // Landed on Level without ever clicking a "Continue" button.
    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
  });

  it('a ?child= deep link skips straight to the Level step too', async () => {
    mockSearchParams = new URLSearchParams({ child: STUDENT._id });

    renderRegisterPage();

    expect(await screen.findByRole('radiogroup', { name: /select a level/i })).toBeInTheDocument();
  });

  it('no longer shows the old explanatory "you can attend any of its scheduled sessions" paragraph', async () => {
    renderRegisterPage();
    await goToPayableState();

    expect(screen.queryByText(/you.re enrolling in the full/i)).not.toBeInTheDocument();
  });

  it('walks Who -> Level -> Done and submits { studentId, scheduleId }, with an existing card on file', async () => {
    renderRegisterPage();
    await goToPayableState();

    expect(await screen.findByText(/card on file: visa ending in 4242/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(postRegistrationPayload).toEqual({ studentId: STUDENT._id, scheduleId: SCHEDULE_A._id });
    });

    expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
  });

  it('the Register & Pay CTA is disabled until a level and time are both chosen', async () => {
    renderRegisterPage();
    await selectChildAndReachLevelStep();

    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));
    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

    const timePill = await screen.findByRole('radio', { name: /wednesday 4:00 pm-5:00 pm/i });
    fireEvent.click(timePill);

    await waitFor(() => expect(screen.getByRole('button', { name: /register & pay/i })).not.toBeDisabled());
  });

  it('back-navigation from Level to Who preserves the selected child', async () => {
    renderRegisterPage();
    await selectChildAndReachLevelStep();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an inline error when the student is already registered for the schedule (409), without crashing', async () => {
    renderRegisterPage();
    await goToPayableState();
    await screen.findByText(/card on file/i);

    server.use(
      http.post('*/registrations', () =>
        HttpResponse.json({ message: 'This student is already registered for this schedule' }, { status: 409 })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This student is already registered for this schedule');
    });

    // Still on the same (Level) step — no dead-end navigation.
    expect(screen.getByText(/card on file/i)).toBeInTheDocument();
  });

  describe('adding a card inline at checkout', () => {
    it('shows the inline card form (not a dead-end link elsewhere) when no card is on file, and unblocks Register & Pay once one is added', async () => {
      server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));
      createPaymentMethodMock.mockResolvedValue({ paymentMethod: STRIPE_PAYMENT_METHOD });

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByTestId('card-element')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /add card/i }));

      await waitFor(() => {
        expect(postPaymentMethodPayload).toEqual({ stripePaymentMethodId: STRIPE_PAYMENT_METHOD.id });
      });

      // The card just added is now shown as "on file" — same underlying
      // PaymentMethod record /parent/payment-method would show — and
      // Register & Pay unblocks without leaving this page.
      expect(await screen.findByText(/card on file: visa ending in 4242/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /register & pay/i })).not.toBeDisabled());

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      await waitFor(() => {
        expect(postRegistrationPayload).toEqual({ studentId: STUDENT._id, scheduleId: SCHEDULE_A._id });
      });
      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    });

    it("shows an inline error when Stripe's createPaymentMethod fails, and Register & Pay stays disabled", async () => {
      server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));
      createPaymentMethodMock.mockResolvedValue({ error: { message: 'Your card number is invalid.' } });

      renderRegisterPage();
      await goToPayableState();

      fireEvent.click(screen.getByRole('button', { name: /add card/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Your card number is invalid.');
      });

      expect(postPaymentMethodPayload).toBeNull();
      expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();
    });

    it('never shows the payment-method section before a time slot is chosen', async () => {
      server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));

      renderRegisterPage();
      await selectChildAndReachLevelStep();
      fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

      expect(screen.queryByTestId('card-element')).not.toBeInTheDocument();
    });
  });

  describe('sibling discount', () => {
    it('shows a live sibling-discount preview once a level and time are both selected', async () => {
      server.use(
        http.get('*/registrations/preview', () =>
          HttpResponse.json({
            ...DEFAULT_PREVIEW,
            chargeAmount: 135,
            totalChargeAmount: 135,
            siblingDiscountApplied: true,
            siblingDiscountAmount: 15,
            siblingDiscountReason:
              'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByText(/10% sibling discount applied — \$135\.00\/month/)).toBeInTheDocument();
      expect(screen.getByText('Sibling Discount')).toBeInTheDocument();
      expect(screen.getByText('-$15.00')).toBeInTheDocument();
      expect(screen.getByText("You'll Pay")).toBeInTheDocument();
      expect(screen.getByText('$135.00')).toBeInTheDocument();
    });

    it('shows no discount lines when the preview reports none', async () => {
      renderRegisterPage();
      await goToPayableState();

      expect(screen.queryByText('Sibling Discount')).not.toBeInTheDocument();
      expect(screen.queryByText("You'll Pay")).not.toBeInTheDocument();
    });

    it('still registers successfully when the discount-preview endpoint fails — the preview is best-effort only', async () => {
      server.use(http.get('*/registrations/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file: visa ending in 4242/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      await waitFor(() => {
        expect(postRegistrationPayload).toEqual({ studentId: STUDENT._id, scheduleId: SCHEDULE_A._id });
      });
      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    });

    it('shows the real applied sibling discount and the backend-supplied reason on the confirmation screen', async () => {
      server.use(
        http.post('*/registrations', async ({ request }) => {
          postRegistrationPayload = await request.json();
          return HttpResponse.json(
            {
              registration: { _id: 'reg-1' },
              subscription: { _id: 'sub-1' },
              chargeAmount: 135,
              totalChargeAmount: 135,
              paymentIntentStatus: 'succeeded',
              siblingDiscountApplied: true,
              siblingDiscountAmount: 15,
              siblingDiscountReason:
                'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
            },
            { status: 201 }
          );
        })
      );

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
      expect(screen.getByText(/\$135\.00/)).toBeInTheDocument();
      expect(screen.getByText('Sibling Discount')).toBeInTheDocument();
      expect(screen.getByText('-$15.00')).toBeInTheDocument();
      expect(
        screen.getByText('This is the lower-priced plan among your active children, so the 10% sibling discount applies here.')
      ).toBeInTheDocument();
    });
  });

  describe('registration fee', () => {
    it('itemizes a configured registration fee separately from the monthly fee, in the Level step summary', async () => {
      server.use(
        http.get('*/registrations/preview', () =>
          HttpResponse.json({ ...DEFAULT_PREVIEW, totalChargeAmount: 175, registrationFeeCharged: 25 })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByText('Registration Fee (one-time)')).toBeInTheDocument();
      expect(screen.getByText('$25.00')).toBeInTheDocument();
      expect(screen.getByText('Due Today')).toBeInTheDocument();
      expect(screen.getByText('$175.00')).toBeInTheDocument();
    });

    it('shows the registration fee and the true total charged on the confirmation screen', async () => {
      server.use(
        http.post('*/registrations', async ({ request }) => {
          postRegistrationPayload = await request.json();
          return HttpResponse.json(
            {
              registration: { _id: 'reg-1' },
              subscription: { _id: 'sub-1' },
              chargeAmount: 150,
              totalChargeAmount: 175,
              paymentIntentStatus: 'succeeded',
              registrationFeeCharged: 25,
              registrationFeeWaived: false,
              registrationFeeReason: null,
            },
            { status: 201 }
          );
        })
      );

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
      expect(screen.getByText(/your card was charged \$175\.00/i)).toBeInTheDocument();
      expect(screen.getByText('Registration Fee (one-time)')).toBeInTheDocument();
      expect(screen.getByText('$25.00')).toBeInTheDocument();
    });

    it('shows the registration fee as waived on the confirmation screen for a returning student', async () => {
      server.use(
        http.post('*/registrations', async ({ request }) => {
          postRegistrationPayload = await request.json();
          return HttpResponse.json(
            {
              registration: { _id: 'reg-1' },
              subscription: { _id: 'sub-1' },
              chargeAmount: 150,
              totalChargeAmount: 150,
              paymentIntentStatus: 'succeeded',
              registrationFeeCharged: 0,
              registrationFeeWaived: true,
              registrationFeeReason: 'Registration fee waived — returning within 6 months of your last enrollment.',
            },
            { status: 201 }
          );
        })
      );

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
      expect(screen.getByText(/your card was charged \$150\.00/i)).toBeInTheDocument();
      expect(screen.getByText('Registration Fee')).toBeInTheDocument();
      expect(screen.getByText('Waived')).toBeInTheDocument();
    });
  });

  describe('prorated first-month billing', () => {
    it('shows the prorated class-day breakdown while choosing a time, and itemizes it in the Level step summary', async () => {
      server.use(
        http.get('*/registrations/preview', () =>
          HttpResponse.json({
            ...DEFAULT_PREVIEW,
            monthlyFee: 300,
            chargeAmount: 160,
            totalChargeAmount: 160,
            prorated: true,
            totalClassDays: 15,
            remainingClassDays: 8,
            dailyRate: 20,
            periodEnd: '2026-08-31T23:59:59.999Z',
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(
        await screen.findByText(/8 of 15 class days remain this month — \$20\.00\/day → \$160\.00 due today/)
      ).toBeInTheDocument();
      expect(screen.getByText(/full price starts aug 31, 2026/i)).toBeInTheDocument();

      expect(screen.getByText('Prorated')).toBeInTheDocument();
      expect(screen.getByText('8 of 15 class days this month')).toBeInTheDocument();
      expect(screen.getByText('Due Today')).toBeInTheDocument();
      expect(screen.getByText('$160.00')).toBeInTheDocument();
      expect(screen.getByText('Full price starts')).toBeInTheDocument();
    });

    it('itemizes the prorated charge and the full-price start date on the confirmation screen', async () => {
      server.use(
        http.post('*/registrations', async ({ request }) => {
          postRegistrationPayload = await request.json();
          return HttpResponse.json(
            {
              registration: { _id: 'reg-1' },
              subscription: { _id: 'sub-1' },
              chargeAmount: 160,
              totalChargeAmount: 160,
              paymentIntentStatus: 'succeeded',
              registrationFeeCharged: 0,
              registrationFeeWaived: false,
              registrationFeeReason: null,
              prorated: true,
              totalClassDays: 15,
              remainingClassDays: 8,
              dailyRate: 20,
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
            { status: 201 }
          );
        })
      );

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
      expect(screen.getByText(/your card was charged \$160\.00/i)).toBeInTheDocument();
      expect(screen.getByText('Prorated')).toBeInTheDocument();
      expect(screen.getByText('8 of 15 class days this month')).toBeInTheDocument();
      expect(screen.getByText('Full price starts')).toBeInTheDocument();
      expect(screen.getByText('Aug 31, 2026')).toBeInTheDocument();
    });

    it('renders exactly as before (no proration UI at all) when prorated is false — the non-prorated path is unaffected', async () => {
      renderRegisterPage();
      await goToPayableState();

      expect(screen.queryByText('Prorated')).not.toBeInTheDocument();
      expect(screen.queryByText('Due Today')).not.toBeInTheDocument();
    });
  });
});
