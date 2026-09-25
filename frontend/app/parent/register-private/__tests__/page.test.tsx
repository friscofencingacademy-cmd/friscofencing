import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPrivatePage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';
import type {
  PaymentMethodInfo,
  PrivateAvailableDate,
  PrivateBookingResult,
  PrivatePurchaseQuote,
  PublicPrivateLessons,
  Student,
} from '../../../../lib/types';

let mockSearchParams = new URLSearchParams({ slot: 'sched-1' });

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const PARENT_USER = { _id: 'parent-1', role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'pat@example.com' };

const STUDENT: Student = {
  _id: 'student-1',
  firstName: 'Sam',
  lastName: 'Kid',
  enrollment: { status: 'not_enrolled', canBookTrial: true, schedule: null },
};

// Server-verbatim regression guard (docs/design-system.md anti-pattern 10):
// the pack's figures deliberately do NOT add up (325 - 291.11 is 33.89, not
// 31.11) — any client-side recomputation would render the wrong numbers.
// Options are keyed by packId, never by quantity or price
// (docs/plans/coach-pack-pricing-plan.md D4).
const OPTIONS: PrivatePurchaseQuote['options'] = [
  { packId: null, unitPrice: 32.5, quantity: 1, subtotal: 32.5, savings: 0, total: 32.5 },
  { packId: 'pack-10', unitPrice: 32.5, quantity: 10, subtotal: 325, savings: 31.11, total: 291.11 },
];

const LESSONS: PublicPrivateLessons = {
  coaches: [
    {
      coachId: 'coach-1',
      coachName: 'Dana Cole',
      slots: [
        {
          scheduleId: 'sched-1',
          dayOfWeek: 2,
          dayName: 'Tuesday',
          startTime: '16:30',
          durationMinutes: 30,
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-12-31T00:00:00.000Z',
          sessionPrice: 32.5,
          hourlyRate: 65,
          options: OPTIONS,
        },
      ],
    },
  ],
};

const DATES: PrivateAvailableDate[] = [
  { day: '2026-10-06', startDate: '2026-10-06T21:30:00.000Z', endDate: '2026-10-06T22:00:00.000Z' },
  { day: '2026-10-13', startDate: '2026-10-13T21:30:00.000Z', endDate: '2026-10-13T22:00:00.000Z' },
];

const QUOTE: PrivatePurchaseQuote = {
  contractId: 'contract-1',
  durationMinutes: 30,
  hourlyRate: 65,
  availableCredits: 0,
  cancelCutoffHours: 24,
  options: OPTIONS,
};

const PAYMENT_METHOD: PaymentMethodInfo = { _id: 'pm-1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 1, cardExpYear: 2030 };

const BOOKED: PrivateBookingResult = {
  session: {
    _id: 'session-1',
    scheduleId: 'sched-1',
    enrollmentId: 'enroll-1',
    coachId: 'coach-1',
    studentId: 'student-1',
    parentId: 'parent-1',
    startDate: '2026-10-06T21:30:00.000Z',
    endDate: '2026-10-06T22:00:00.000Z',
    status: 'confirmed',
  },
  remaining: 9,
};

let purchasePayload: unknown = null;
let creditPayload: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-schedules/public', () => HttpResponse.json(LESSONS)),
  http.get('*/private-class-schedules/sched-1/available-dates', () => HttpResponse.json({ dates: DATES })),
  http.get('*/private-class-enrollments/quote', () => HttpResponse.json(QUOTE)),
  http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: PAYMENT_METHOD })),
  http.post('*/private-class-enrollments', async ({ request }) => {
    purchasePayload = await request.json();
    return HttpResponse.json(BOOKED, { status: 201 });
  }),
  http.post('*/private-class-sessions', async ({ request }) => {
    creditPayload = await request.json();
    return HttpResponse.json({ ...BOOKED, remaining: 4 }, { status: 201 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  purchasePayload = null;
  creditPayload = null;
  mockSearchParams = new URLSearchParams({ slot: 'sched-1' });
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <ParentPortalProvider>
        <RegisterPrivatePage />
      </ParentPortalProvider>
    </AuthProvider>
  );
}

async function walkToSessions(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/who is this for/i);
  await user.click(await screen.findByRole('radio', { name: /sam kid/i }));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.click(await screen.findByRole('radio', { name: /tue, oct 6/i }));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/how many sessions/i);
}

describe('RegisterPrivatePage — book a private lesson', () => {
  it('Who -> When -> a 10-session pack -> Review -> Done, rendering every figure verbatim and posting the payload', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Dana Cole — Tuesdays · 4:30 PM · 30 min')).toBeInTheDocument();
    await walkToSessions(user);

    await user.click(screen.getByRole('radio', { name: /buy 10 sessions/i }));
    expect(screen.getByText('$291.11 · save $31.11')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/cancel at least 24 hours before a lesson/i)).toBeInTheDocument();
    expect(screen.getByText(/visa ending in 4242/i)).toBeInTheDocument();
    expect(screen.getByText('10 × $32.50')).toBeInTheDocument();
    expect(screen.getByText('Pack savings')).toBeInTheDocument();
    expect(screen.getByText('−$31.11')).toBeInTheDocument();
    expect(screen.getByText('$291.11')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pay $291.11 & book' }));

    // The request names the pack, never a quantity or a price.
    await waitFor(() =>
      expect(purchasePayload).toEqual({
        studentId: 'student-1',
        scheduleId: 'sched-1',
        day: '2026-10-06',
        contractId: 'contract-1',
        packId: 'pack-10',
      })
    );
    expect(await screen.findByText(/you're booked/i)).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Tue, Oct 6, 2026, 4:30 PM')).toBeInTheDocument();
  });

  it('offers a paid session first when the child has credits, and books with it (no card needed)', async () => {
    server.use(
      http.get('*/private-class-enrollments/quote', () => HttpResponse.json({ ...QUOTE, availableCredits: 5 })),
      http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null }))
    );
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);

    const options = screen.getAllByRole('radio');
    expect(within(options[0]).getByText('Use a paid session')).toBeInTheDocument();
    expect(within(options[0]).getByText('5 left')).toBeInTheDocument();

    await user.click(options[0]);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/no card charge/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /book with a paid session/i }));

    await waitFor(() =>
      expect(creditPayload).toEqual({ studentId: 'student-1', scheduleId: 'sched-1', day: '2026-10-06' })
    );
    expect(purchasePayload).toBeNull();
    expect(await screen.findByText(/you're booked/i)).toBeInTheDocument();
  });

  it('buys a single session with no packId in the request', async () => {
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);

    await user.click(screen.getByRole('radio', { name: /buy 1 session/i }));
    expect(screen.queryByText('Pack savings')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: 'Pay $32.50 & book' }));

    await waitFor(() =>
      expect(purchasePayload).toEqual({ studentId: 'student-1', scheduleId: 'sched-1', day: '2026-10-06', contractId: 'contract-1' })
    );
  });

  // docs/plans/coach-pack-pricing-plan.md D11 / §8 V5 — a contract edited
  // after the quote (prices changed), or a pack no longer offered, is
  // refused (409) and handled through the SAME inline error path as a
  // decline: nothing charged, the quote refetched, "Pick another date".
  it('shows changed prices (409) inline, refetches the quote, and offers "Pick another date"', async () => {
    let quoteFetches = 0;
    server.use(
      http.post('*/private-class-enrollments', () =>
        HttpResponse.json({ message: 'Prices have changed — please review them' }, { status: 409 })
      ),
      http.get('*/private-class-enrollments/quote', () => {
        quoteFetches += 1;
        return HttpResponse.json(QUOTE);
      })
    );
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);
    await user.click(screen.getByRole('radio', { name: /buy 10 sessions/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const fetchesBeforeSubmit = quoteFetches;
    await user.click(await screen.findByRole('button', { name: 'Pay $291.11 & book' }));

    expect(await screen.findByText(/prices have changed/i)).toBeInTheDocument();
    await waitFor(() => expect(quoteFetches).toBeGreaterThan(fetchesBeforeSubmit));
    expect(screen.getByRole('button', { name: /pick another date/i })).toBeInTheDocument();
    expect(screen.queryByText(/you're booked/i)).not.toBeInTheDocument();
  });

  it('blocks paying without a saved card', async () => {
    server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);

    await user.click(screen.getByRole('radio', { name: /buy 1 session/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/add a payment method before booking/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $32.50 & book' })).toBeDisabled();
  });

  it('shows a declined card (402) inline without crashing, refetches, and lets the parent pick another date', async () => {
    let dateFetches = 0;
    server.use(
      http.post('*/private-class-enrollments', () =>
        HttpResponse.json({ message: 'Your card was declined.' }, { status: 402 })
      ),
      http.get('*/private-class-schedules/sched-1/available-dates', () => {
        dateFetches += 1;
        return HttpResponse.json({ dates: DATES });
      })
    );
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);
    await user.click(screen.getByRole('radio', { name: /buy 1 session/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const fetchesBeforeSubmit = dateFetches;
    await user.click(await screen.findByRole('button', { name: 'Pay $32.50 & book' }));

    expect(await screen.findByText(/your card was declined/i)).toBeInTheDocument();
    await waitFor(() => expect(dateFetches).toBeGreaterThan(fetchesBeforeSubmit));

    await user.click(screen.getByRole('button', { name: /pick another date/i }));
    expect(await screen.findByText(/pick a date/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
  });

  it('says so when the slot has no open dates, and when the coach is not taking new bookings', async () => {
    server.use(
      http.get('*/private-class-schedules/sched-1/available-dates', () => HttpResponse.json({ dates: [] }))
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/who is this for/i);
    await user.click(await screen.findByRole('radio', { name: /sam kid/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/no open dates for this time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('shows the not-taking-bookings notice when there are neither options nor credits', async () => {
    server.use(
      http.get('*/private-class-enrollments/quote', () =>
        HttpResponse.json({ ...QUOTE, hourlyRate: null, options: [], availableCredits: 0 })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);

    expect(screen.getByText(/isn't taking new bookings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('points to the listing when no slot was chosen, and flags a slot that is no longer offered', async () => {
    mockSearchParams = new URLSearchParams();
    const { unmount } = renderPage();
    expect(await screen.findByRole('link', { name: /browse private lesson times/i })).toHaveAttribute(
      'href',
      '/private-classes'
    );
    unmount();

    mockSearchParams = new URLSearchParams({ slot: 'gone' });
    renderPage();
    expect(await screen.findByText(/that time is no longer offered/i)).toBeInTheDocument();
  });

  it('renders LoadError with a working retry when the catalog fails to load', async () => {
    server.use(
      http.get('*/private-class-schedules/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    server.use(http.get('*/private-class-schedules/public', () => HttpResponse.json(LESSONS)));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/who is this for/i)).toBeInTheDocument();
  });
});
