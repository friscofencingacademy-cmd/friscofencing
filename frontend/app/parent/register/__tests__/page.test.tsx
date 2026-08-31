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

// The register wizard's start-date picker now filters against "today," so
// every test in this file runs under a frozen clock — per
// TESTING_STRATEGY.md's date rules, never the real wall clock against a
// today-computing subject. `jest.useFakeTimers` is deliberately NOT used
// here: paired with MSW's jsdom XHR stack it reliably hangs Testing
// Library's own setTimeout-based waitFor/findBy polling (confirmed while
// building this suite — a fresh run under fake timers never completed).
// Instead, `global.Date` itself is swapped for a thin subclass (see
// beforeEach/afterEach below) — `new Date()`/`Date.now()` return the frozen
// instant, `new Date(isoString)` parses normally, and Jest's real timers
// (and therefore RTL's polling) are completely untouched.
//
// CURRENT_NOW sits mid-month (the 10th) so the default 14-day window
// (-> the 24th) never spills into next month; the spill case gets its own
// nested describe below with a different frozen instant.
let CURRENT_NOW = new Date('2099-01-10T12:00:00.000Z');
const FIXED_NOW = CURRENT_NOW;
const RealDate = global.Date;

class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(CURRENT_NOW.getTime());
    } else {
      // @ts-expect-error — every real call site here passes either zero
      // args (wants "now") or a single ISO string (real parsing); both are
      // handled correctly by the base Date constructor via this spread.
      super(...args);
    }
  }

  static now(): number {
    return CURRENT_NOW.getTime();
  }
}

// A session carries its own schedule's day/time — no separate "choose your
// preferred time" step any more. Picking one sets both the schedule AND the
// start date at once. Both dates sit inside FIXED_NOW's default 14-day
// window (Jan 10 -> Jan 24).
const SESSION_A = {
  _id: 'session-a',
  date: '2099-01-12T00:00:00.000Z',
  scheduleId: { _id: 'sched-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
};
const SESSION_A_LATER = {
  _id: 'session-a-later',
  date: '2099-01-19T00:00:00.000Z',
  scheduleId: { _id: 'sched-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
};

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
  periodEnd: '2099-01-31T00:00:00.000Z',
  // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
  // alignment-plan.md, Phase 3) — nothing to save by default; individual
  // tests override this alongside siblingDiscountAmount/
  // registrationFeeWaived when they need a non-zero figure.
  savings: { siblingDiscount: 0, registrationFeeWaived: 0, total: 0 },
};

let postRegistrationPayload: unknown = null;
let postPaymentMethodPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
    if (params.classId === CLASS_A._id) {
      return HttpResponse.json({ sessions: [SESSION_A, SESSION_A_LATER] });
    }
    return HttpResponse.json({ sessions: [] });
  }),
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
        paymentStatus: 'completed',
        registrationFeeCharged: 0,
        registrationFeeWaived: false,
        registrationFeeReason: null,
        prorated: false,
        totalClassDays: null,
        remainingClassDays: null,
        dailyRate: null,
        periodEnd: '2099-01-31T00:00:00.000Z',
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
beforeEach(() => {
  CURRENT_NOW = FIXED_NOW;
  global.Date = FrozenDate as DateConstructor;
});
afterEach(() => {
  server.resetHandlers();
  postRegistrationPayload = null;
  postPaymentMethodPayload = null;
  mockSearchParams = new URLSearchParams();
  createPaymentMethodMock.mockReset();
  global.Date = RealDate;
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

// SESSION_A and SESSION_A_LATER share the same weekly time (two upcoming
// occurrences of the same Wed 4pm class) — sorted soonest-first, so the
// FIRST matching pill is always SESSION_A. Selecting by array position
// rather than a date-formatted label keeps this independent of the test
// runner's local timezone (toLocaleDateString renders differently per TZ).
async function goToPayableState() {
  await selectChildAndReachLevelStep();
  fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));
  const [sessionPill] = await screen.findAllByRole('radio', { name: /4:00 PM–5:00 PM/i });
  fireEvent.click(sessionPill);
  await waitFor(() => expect(sessionPill).toHaveAttribute('aria-checked', 'true'));
}

describe('RegisterPage wizard', () => {
  it('selecting a child reveals the Level section below it — no explicit "Continue" click, and the child stays on screen', async () => {
    renderRegisterPage();

    // Before selecting anyone, the Level picker isn't rendered at all, and
    // the CTA is always "Register & Pay" — no "Continue" step exists.
    expect(screen.queryByRole('radiogroup', { name: /select a level/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

    await selectChildAndReachLevelStep();

    // Landed on Level without ever clicking a "Continue" button, and the
    // selected child card is still visible and checked.
    expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /kid one/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('a ?child= deep link reveals the Level section too', async () => {
    mockSearchParams = new URLSearchParams({ child: STUDENT._id });

    renderRegisterPage();

    expect(await screen.findByRole('radiogroup', { name: /select a level/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /kid one/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows every upcoming session (start date) for the chosen level as pickable options, not just one time slot', async () => {
    renderRegisterPage();
    await selectChildAndReachLevelStep();
    fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

    const pills = await screen.findAllByRole('radio', { name: /4:00 PM–5:00 PM/i });
    expect(pills).toHaveLength(2);
  });

  it('walks Who -> Level -> Done and submits { studentId, scheduleId, startDate }, with an existing card on file', async () => {
    renderRegisterPage();
    await goToPayableState();

    expect(await screen.findByText(/card on file: visa ending in 4242/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(postRegistrationPayload).toEqual({
        studentId: STUDENT._id,
        scheduleId: SESSION_A.scheduleId._id,
        startDate: SESSION_A.date,
      });
    });

    expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
  });

  it('shows a distinct "processing" state, not the success screen, when paymentStatus is "pending" (docs/decisions/008-registration-create-pending-first.md)', async () => {
    server.use(
      http.post('*/registrations', () =>
        HttpResponse.json(
          {
            registration: { _id: 'reg-1' },
            subscription: { _id: 'sub-1' },
            chargeAmount: 150,
            totalChargeAmount: 150,
            paymentStatus: 'pending',
            registrationFeeCharged: 0,
            registrationFeeWaived: false,
            registrationFeeReason: null,
            prorated: false,
            totalClassDays: null,
            remainingClassDays: null,
            dailyRate: null,
            periodEnd: '2099-01-31T00:00:00.000Z',
          },
          { status: 201 }
        )
      )
    );

    renderRegisterPage();
    await goToPayableState();

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    expect(await screen.findByText('Registration received')).toBeInTheDocument();
    expect(screen.queryByText('Registration complete!')).not.toBeInTheDocument();
    expect(screen.getByText(/we couldn't charge your card just now/i)).toBeInTheDocument();
  });

  it('the Register & Pay CTA is disabled until a level and start date are both chosen', async () => {
    renderRegisterPage();
    await selectChildAndReachLevelStep();

    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));
    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();

    const [sessionPill] = await screen.findAllByRole('radio', { name: /4:00 PM–5:00 PM/i });
    fireEvent.click(sessionPill);

    await waitFor(() => expect(screen.getByRole('button', { name: /register & pay/i })).not.toBeDisabled());
  });

  it('picking a level and start date keeps the child card visible and checked — no separate navigable step', async () => {
    renderRegisterPage();
    await goToPayableState();

    expect(screen.getByRole('radio', { name: /kid one/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radiogroup', { name: /select a level/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
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

    // The form stays on screen — no dead-end navigation.
    expect(screen.getByText(/card on file/i)).toBeInTheDocument();
  });

  // docs/plans/booking-and-private-class-fixes-plan.md §1 — a
  // server-decided `student.enrollment` (student.service.js's
  // attachEnrollment()) now blocks an already-enrolled child at the Who
  // step, instead of only failing at the final Register & Pay submit via
  // the backend's one-active-subscription-per-student guard.
  describe('RegisterPage wizard — already-enrolled child (booking-and-private-class-fixes plan §1)', () => {
    const ENROLLED_STUDENT = {
      _id: 'student-enrolled',
      firstName: 'Sana',
      lastName: 'Sarath',
      enrollment: {
        status: 'enrolled',
        canBookTrial: false,
        schedule: { dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
      },
    };
    const NOT_ENROLLED_STUDENT = {
      _id: 'student-fresh',
      firstName: 'Fresh',
      lastName: 'Kid',
      enrollment: { status: 'not_enrolled', canBookTrial: true, schedule: null },
    };

    it('shows an "Already enrolled" chip on the enrolled child\'s card, and none on a not-yet-enrolled child\'s', async () => {
      server.use(
        http.get('*/students/mine', () =>
          HttpResponse.json({ students: [ENROLLED_STUDENT, NOT_ENROLLED_STUDENT] })
        )
      );

      renderRegisterPage();

      expect(await screen.findByText('Already enrolled')).toBeInTheDocument();
    });

    it('selecting the enrolled child shows a blocking notice instead of the Level section', async () => {
      server.use(
        http.get('*/students/mine', () =>
          HttpResponse.json({ students: [ENROLLED_STUDENT, NOT_ENROLLED_STUDENT] })
        )
      );

      renderRegisterPage();
      fireEvent.click(await screen.findByRole('radio', { name: /sana sarath/i }));

      expect(await screen.findByText(/sana is already enrolled/i)).toBeInTheDocument();
      expect(screen.getByText(/every wednesday.*4:00 pm.*5:00 pm/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /my registrations/i })).toHaveAttribute(
        'href',
        '/parent/subscriptions'
      );
      expect(screen.queryByRole('radiogroup', { name: /select a level/i })).not.toBeInTheDocument();
      // The selected child card stays visible/checked — same "no dead-end
      // navigation" pattern the rest of this wizard already follows.
      expect(screen.getByRole('radio', { name: /sana sarath/i })).toHaveAttribute('aria-checked', 'true');
    });

    it('a ?child= deep link to the enrolled child lands on the same notice', async () => {
      mockSearchParams = new URLSearchParams({ child: ENROLLED_STUDENT._id });
      server.use(
        http.get('*/students/mine', () =>
          HttpResponse.json({ students: [ENROLLED_STUDENT, NOT_ENROLLED_STUDENT] })
        )
      );

      renderRegisterPage();

      expect(await screen.findByText(/sana is already enrolled/i)).toBeInTheDocument();
    });

    it('renders the notice with no day/time line, and without crashing, when the schedule reference is orphaned', async () => {
      const orphanedSchedule = {
        ...ENROLLED_STUDENT,
        enrollment: { ...ENROLLED_STUDENT.enrollment, schedule: null },
      };
      server.use(http.get('*/students/mine', () => HttpResponse.json({ students: [orphanedSchedule] })));

      renderRegisterPage();
      fireEvent.click(await screen.findByRole('radio', { name: /sana sarath/i }));

      expect(await screen.findByText(/sana is already enrolled\./i)).toBeInTheDocument();
      expect(screen.queryByText(/every/i)).not.toBeInTheDocument();
    });

    it('a not-yet-enrolled child still advances to the Level step normally — regression guard', async () => {
      server.use(
        http.get('*/students/mine', () =>
          HttpResponse.json({ students: [ENROLLED_STUDENT, NOT_ENROLLED_STUDENT] })
        )
      );

      renderRegisterPage();
      fireEvent.click(await screen.findByRole('radio', { name: /fresh kid/i }));

      expect(await screen.findByRole('radiogroup', { name: /select a level/i })).toBeInTheDocument();
      expect(screen.queryByText(/is already enrolled/i)).not.toBeInTheDocument();
    });
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
        expect(postRegistrationPayload).toEqual({
          studentId: STUDENT._id,
          scheduleId: SESSION_A.scheduleId._id,
          startDate: SESSION_A.date,
        });
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

    it('never shows the payment-method section before a start date is chosen', async () => {
      server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));

      renderRegisterPage();
      await selectChildAndReachLevelStep();
      fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

      expect(screen.queryByTestId('card-element')).not.toBeInTheDocument();
    });
  });

  // docs/plans/frontend-polish-plan.md PR 5.1 — the register wizard's
  // summary is fed exclusively by GET /registrations/preview; this asserts
  // the rendered summary shows the server's numbers VERBATIM. Deliberately
  // distinctive, non-round, mutually-inconsistent-looking values (they
  // don't "add up" to each other on purpose) — any client-side arithmetic
  // creeping back in would either recompute a different, wrong number or
  // crash trying to derive one from fields that don't relate this way.
  describe('server-verbatim quote regression guard', () => {
    it('renders every quote figure exactly as the preview response sent it, with no client-side recomputation', async () => {
      server.use(
        http.get('*/registrations/preview', () =>
          HttpResponse.json({
            ...DEFAULT_PREVIEW,
            chargeAmount: 123.47,
            totalChargeAmount: 199.68,
            siblingDiscountApplied: true,
            siblingDiscountAmount: 11.03,
            siblingDiscountReason: 'A distinctive test-only reason string.',
            registrationFeeCharged: 87.21,
            registrationFeeWaived: false,
            savings: { siblingDiscount: 11.03, registrationFeeWaived: 0, total: 11.03 },
            // Family-breakdown fields (docs/plans/booking-flow-sequential-
            // plan.md) — distinctive, non-round values too, same discipline.
            discountBase: 110.3,
            siblingComparison: [{ studentId: 'sibling-verbatim', studentName: 'Verbatim Sibling', monthlyFee: 220.6 }],
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByText('-$11.03')).toBeInTheDocument();
      expect(screen.getByText('$123.47')).toBeInTheDocument();
      expect(screen.getByText('$87.21')).toBeInTheDocument();
      expect(screen.getByText('$199.68')).toBeInTheDocument();
      expect(screen.getByText('$11.03')).toBeInTheDocument();
      expect(screen.getByText('Verbatim Sibling — current plan')).toBeInTheDocument();
      expect(screen.getByText('$220.6/mo')).toBeInTheDocument();
      expect(screen.getByText('Sibling Discount (10% of $110.30)*')).toBeInTheDocument();
      // Never a derived/summed figure this page didn't receive verbatim.
      expect(screen.queryByText('$210.71')).not.toBeInTheDocument(); // 123.47 + 87.21
      expect(screen.queryByText('$134.50')).not.toBeInTheDocument(); // 123.47 + 11.03
    });
  });

  describe('sibling discount', () => {
    it('shows a live sibling-discount preview once a level and start date are both selected', async () => {
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
            savings: { siblingDiscount: 15, registrationFeeWaived: 0, total: 15 },
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      // The discount line lives only in the quote panel now — no duplicate
      // sentence on the left (docs/plans/booking-flow-sequential-plan.md
      // point 3/4). Falls back to the plain "Sibling Discount" label (no
      // "(10% of $X)" suffix) since this fixture doesn't include
      // discountBase — proven by the server-verbatim guard test below too.
      expect(await screen.findByText('Sibling Discount')).toBeInTheDocument();
      expect(screen.getByText('-$15.00')).toBeInTheDocument();
      expect(screen.getByText("You'll Pay")).toBeInTheDocument();
      // $135.00 appears twice here — "You'll Pay" (the recurring monthly
      // rate) and "Due at enrollment" (the one-time initial total) are
      // numerically identical whenever there's no fee or proration to
      // separate them, which is exactly this case.
      expect(screen.getAllByText('$135.00')).toHaveLength(2);
      expect(screen.getByText('Due at enrollment')).toBeInTheDocument();
      // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
      // alignment-plan.md, Phase 3) — the aggregate "You Save" line, read
      // straight from the backend's own sum.
      expect(screen.getByText('You Save')).toBeInTheDocument();
      expect(screen.getByText('$15.00')).toBeInTheDocument();
      // The footnote (owner's exact ask, docs/plans/booking-flow-sequential
      // -plan.md) shows whenever the discount row shows, even without
      // discountBase/siblingComparison from an older backend.
      expect(
        screen.getByText(/the 10% sibling discount always applies to the lower-priced plan/i)
      ).toBeInTheDocument();
    });

    it('shows no discount lines when the preview reports none', async () => {
      renderRegisterPage();
      await goToPayableState();

      expect(screen.queryByText('Sibling Discount')).not.toBeInTheDocument();
      expect(screen.queryByText("You'll Pay")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/the 10% sibling discount always applies to the lower-priced plan/i)
      ).not.toBeInTheDocument();
    });

    it('lists each active sibling\'s own current plan and shows the discount base in the label, so the 10% calculation is traceable (docs/plans/booking-flow-sequential-plan.md point 4)', async () => {
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
            discountBase: 150,
            siblingComparison: [{ studentId: 'sibling-1', studentName: 'Sibling One', monthlyFee: 200 }],
            savings: { siblingDiscount: 15, registrationFeeWaived: 0, total: 15 },
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByText('Sibling One — current plan')).toBeInTheDocument();
      expect(screen.getByText('$200/mo')).toBeInTheDocument();
      expect(screen.getByText('Sibling Discount (10% of $150.00)*')).toBeInTheDocument();
      expect(screen.getByText('-$15.00')).toBeInTheDocument();
      expect(
        screen.getByText(/the 10% sibling discount always applies to the lower-priced plan/i)
      ).toBeInTheDocument();
    });

    it('still registers successfully when the discount-preview endpoint fails — the preview is best-effort only', async () => {
      server.use(http.get('*/registrations/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

      renderRegisterPage();
      await goToPayableState();
      await screen.findByText(/card on file: visa ending in 4242/i);

      fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

      await waitFor(() => {
        expect(postRegistrationPayload).toEqual({
          studentId: STUDENT._id,
          scheduleId: SESSION_A.scheduleId._id,
          startDate: SESSION_A.date,
        });
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
              paymentStatus: 'completed',
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
      expect(screen.getByText('Due at enrollment')).toBeInTheDocument();
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
              paymentStatus: 'completed',
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

    it('itemizes a waived registration fee with a "You Save" line, in the Level step summary (Family Scorecard checkout quote panel, docs/plans/wordpress-ui-alignment-plan.md Phase 3)', async () => {
      server.use(
        http.get('*/registrations/preview', () =>
          HttpResponse.json({
            ...DEFAULT_PREVIEW,
            registrationFeeCharged: 0,
            registrationFeeWaived: true,
            registrationFeeReason: 'Registration fee waived — returning within 6 months of your last enrollment.',
            savings: { siblingDiscount: 0, registrationFeeWaived: 25, total: 25 },
          })
        )
      );

      renderRegisterPage();
      await goToPayableState();

      expect(await screen.findByText('Registration Fee')).toBeInTheDocument();
      expect(screen.getByText('Waived')).toBeInTheDocument();
      expect(
        screen.getByText('Registration fee waived — returning within 6 months of your last enrollment.')
      ).toBeInTheDocument();
      // registrationFeeCharged is 0 here (same as "no fee configured" would
      // be) — savings.registrationFeeWaived is the only place the waived
      // fee's actual dollar value exists at all.
      expect(screen.getByText('You Save')).toBeInTheDocument();
      expect(screen.getByText('$25.00')).toBeInTheDocument();
    });

    it('shows the registration fee as waived, with the same "You Saved" line, on the confirmation screen for a returning student', async () => {
      server.use(
        http.post('*/registrations', async ({ request }) => {
          postRegistrationPayload = await request.json();
          return HttpResponse.json(
            {
              registration: { _id: 'reg-1' },
              subscription: { _id: 'sub-1' },
              chargeAmount: 150,
              totalChargeAmount: 150,
              paymentStatus: 'completed',
              registrationFeeCharged: 0,
              registrationFeeWaived: true,
              registrationFeeReason: 'Registration fee waived — returning within 6 months of your last enrollment.',
              savings: { siblingDiscount: 0, registrationFeeWaived: 25, total: 25 },
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
      expect(screen.getByText('You Saved')).toBeInTheDocument();
      expect(screen.getByText('$25.00')).toBeInTheDocument();
    });
  });

  describe('prorated first-month billing', () => {
    it('shows the prorated class-day breakdown while choosing a start date, and itemizes it in the Level step summary', async () => {
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

      // The per-day rate now lives in the Prorated row itself — no
      // duplicate sentence on the left (docs/plans/booking-flow-sequential
      // -plan.md points 3/4).
      expect(await screen.findByText('8 of 15 class days · $20.00/day')).toBeInTheDocument();
      expect(screen.getByText('Prorated')).toBeInTheDocument();
      expect(screen.getByText('Due at enrollment')).toBeInTheDocument();
      expect(screen.getByText('$160.00')).toBeInTheDocument();
      expect(screen.getByText('Full price starts')).toBeInTheDocument();
      expect(screen.getByText('Aug 31, 2026')).toBeInTheDocument();
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
              paymentStatus: 'completed',
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

    it('shows no proration UI when prorated is false, though "Due at enrollment" still appears (it always does once a preview loads)', async () => {
      renderRegisterPage();
      await goToPayableState();

      // "Due at enrollment" (docs/plans/wordpress-ui-alignment-plan.md,
      // Phase 3) is the one number a parent walks away with — shown
      // whenever a preview has loaded, even when (as here) it's identical
      // to "Monthly Fee" with nothing to explain the difference. findByText
      // (not getByText): the preview is an async fetch this test doesn't
      // otherwise wait on.
      expect(await screen.findByText('Due at enrollment')).toBeInTheDocument();
      expect(screen.queryByText('Prorated')).not.toBeInTheDocument();
    });
  });

  describe('start-date window', () => {
    it('excludes a session more than 14 days out even when it is still in the current calendar month', async () => {
      // FIXED_NOW is Jan 10 here (the file default) — window end is Jan 24
      // (the plain 14-day cap, not yet touching month-end). A session on
      // Jan 26 is 16 days out: still January, but outside the window.
      const sessionBeyondWindow = {
        _id: 'session-beyond-window',
        date: '2099-01-26T00:00:00.000Z',
        scheduleId: { _id: 'sched-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
      };
      server.use(
        http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
          if (params.classId === CLASS_A._id) {
            return HttpResponse.json({ sessions: [SESSION_A, sessionBeyondWindow] });
          }
          return HttpResponse.json({ sessions: [] });
        })
      );

      renderRegisterPage();
      await selectChildAndReachLevelStep();
      fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

      const pills = await screen.findAllByRole('radio', { name: /4:00 PM–5:00 PM/i });
      expect(pills).toHaveLength(1);
    });

    describe('when 14 days would spill into next month', () => {
      const LATE_MONTH_NOW = new Date('2099-01-28T12:00:00.000Z');
      // Window is Jan 28 -> Jan 31 (month-end caps it well short of 14 days).
      const SESSION_LATE_THIS_MONTH = {
        _id: 'session-late-this-month',
        date: '2099-01-30T00:00:00.000Z',
        scheduleId: { _id: 'sched-1', dayOfWeek: 5, startTime: '16:00', endTime: '17:00' },
      };
      // 6 days out from LATE_MONTH_NOW — well within a plain 14-day count,
      // but it's February: must be excluded from the this-month picker and
      // is instead the real session "Enroll for next month" anchors to.
      const SESSION_NEXT_MONTH = {
        _id: 'session-next-month',
        date: '2099-02-03T00:00:00.000Z',
        scheduleId: { _id: 'sched-1', dayOfWeek: 2, startTime: '18:00', endTime: '19:00' },
      };

      beforeEach(() => {
        CURRENT_NOW = LATE_MONTH_NOW;
      });

      it('caps the picker at month-end (not the full 14 days) and offers "Enroll for next month" for the real next-month session', async () => {
        server.use(
          http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
            if (params.classId === CLASS_A._id) {
              return HttpResponse.json({ sessions: [SESSION_LATE_THIS_MONTH, SESSION_NEXT_MONTH] });
            }
            return HttpResponse.json({ sessions: [] });
          })
        );

        renderRegisterPage();
        await selectChildAndReachLevelStep();
        fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

        // Wait for sessions to actually finish loading (the level-picker's
        // own radios already exist by this point and would otherwise
        // satisfy a bare findAllByRole('radio') immediately) before
        // counting session pills specifically.
        await screen.findByRole('radiogroup', { name: /select a start date/i });

        // Only the January session is offered as a pill — February's is not,
        // even though it's well within a raw 14-day count.
        const pills = screen.getAllByRole('radio', { name: /4:00 PM–5:00 PM/i });
        expect(pills).toHaveLength(1);

        expect(screen.getByRole('button', { name: /enroll for next month/i })).not.toBeDisabled();
        expect(screen.getByText(/first class: .*6:00 PM–7:00 PM/i)).toBeInTheDocument();
      });

      it('clicking "Enroll for next month" selects the real next-month session and submits its real date — no invented data', async () => {
        server.use(
          http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
            if (params.classId === CLASS_A._id) {
              return HttpResponse.json({ sessions: [SESSION_LATE_THIS_MONTH, SESSION_NEXT_MONTH] });
            }
            return HttpResponse.json({ sessions: [] });
          }),
          // A future-month anchor never prorates, full stop (docs/plans/
          // payment-airtight-plan.md D1) — regardless of which day of that
          // month the real next session happens to land on.
          http.get('*/registrations/preview', () =>
            HttpResponse.json({
              ...DEFAULT_PREVIEW,
              monthlyFee: 150,
              chargeAmount: 150,
              totalChargeAmount: 150,
              prorated: false,
              totalClassDays: 0,
              remainingClassDays: 0,
              dailyRate: 0,
              periodEnd: '2099-03-01T00:00:00.000Z',
            })
          )
        );

        renderRegisterPage();
        await selectChildAndReachLevelStep();
        fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

        fireEvent.click(await screen.findByRole('button', { name: /enroll for next month/i }));

        // Full-price framing in the quote panel — "Due at enrollment" shows
        // the full fee, and no "Prorated" row appears at all.
        expect(await screen.findByText('$150.00')).toBeInTheDocument();
        expect(screen.queryByText('Prorated')).not.toBeInTheDocument();

        await screen.findByText(/card on file: visa ending in 4242/i);
        fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

        await waitFor(() => {
          expect(postRegistrationPayload).toEqual({
            studentId: STUDENT._id,
            scheduleId: SESSION_NEXT_MONTH.scheduleId._id,
            startDate: SESSION_NEXT_MONTH.date,
          });
        });

        expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
        // Confirmation screen also suppresses "Prorated" for this path.
        expect(screen.queryByText('Prorated')).not.toBeInTheDocument();
        expect(screen.getByText('Plan renews')).toBeInTheDocument();
      });

      it('disables "Enroll for next month" with an explanatory note when no next-month session exists in the fetched data yet', async () => {
        server.use(
          http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
            if (params.classId === CLASS_A._id) {
              return HttpResponse.json({ sessions: [SESSION_LATE_THIS_MONTH] });
            }
            return HttpResponse.json({ sessions: [] });
          })
        );

        renderRegisterPage();
        await selectChildAndReachLevelStep();
        fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

        expect(await screen.findByRole('button', { name: /enroll for next month/i })).toBeDisabled();
        expect(screen.getByText(/next month's schedule isn't posted yet/i)).toBeInTheDocument();
      });

      it('shows a message instead of pills when no this-month dates remain, while "Enroll for next month" still works', async () => {
        server.use(
          http.get('*/group-class-sessions/by-class/:classId', ({ params }) => {
            if (params.classId === CLASS_A._id) {
              return HttpResponse.json({ sessions: [SESSION_NEXT_MONTH] });
            }
            return HttpResponse.json({ sessions: [] });
          })
        );

        renderRegisterPage();
        await selectChildAndReachLevelStep();
        fireEvent.click(screen.getByRole('radio', { name: /beginner/i }));

        expect(
          await screen.findByText(/no class dates available in the next two weeks this month/i)
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /enroll for next month/i })).not.toBeDisabled();
      });
    });
  });
});
