import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import RegisterPrivatePage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';
import type {
  CalendarEvent,
  CalendarResponse,
  PaymentMethodInfo,
  PrivateBookingResult,
  PrivatePurchaseQuote,
  PublicPrivateClassSlot,
  PublicPrivateLessons,
  Student,
} from '../../../../lib/types';

let mockSearchParams = new URLSearchParams({ slot: 'sched-1' });

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

// The wizard lists open slots from "today" to the booking horizon, so every
// test runs under a frozen clock (TESTING_STRATEGY.md's date rules). Only
// `Date` is swapped — fake timers hang alongside MSW (see
// app/parent/register/__tests__/page.test.tsx's top comment). Mon Oct 5 2026,
// 9 AM Central: the fixture slots on Tue Oct 6 and Tue Oct 13 are ahead.
const FROZEN_NOW = new Date('2026-10-05T14:00:00.000Z');
const RealDate = global.Date;

class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(FROZEN_NOW.getTime());
    } else {
      // @ts-expect-error — every call site passes zero args ("now") or one
      // ISO string / epoch, both handled by the base constructor.
      super(...args);
    }
  }

  static now(): number {
    return FROZEN_NOW.getTime();
  }
}

const PARENT_USER = { _id: 'parent-1', role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'pat@example.com' };

const STUDENT: Student = {
  _id: 'student-1',
  firstName: 'Sam',
  lastName: 'Kid',
  enrollment: { status: 'not_enrolled', canBookTrial: true, schedule: null, trial: null },
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

function slot(scheduleId: string, startTime: string, overrides: Partial<PublicPrivateClassSlot> = {}): PublicPrivateClassSlot {
  return {
    scheduleId,
    dayOfWeek: 2,
    dayName: 'Tuesday',
    startTime,
    durationMinutes: 30,
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    sessionPrice: 32.5,
    hourlyRate: 65,
    options: OPTIONS,
    ...overrides,
  };
}

// One window, Tue 4:30–5:30 PM (two 30-minute slots), plus the same coach's
// Thursday slot — a different window, never offered from this one.
const LESSONS: PublicPrivateLessons = {
  coaches: [
    {
      coachId: 'coach-1',
      coachName: 'Dana Cole',
      slots: [slot('sched-1', '16:30'), slot('sched-2', '17:00'), slot('sched-thu', '16:30', { dayOfWeek: 4, dayName: 'Thursday' })],
    },
  ],
};

function openEvent(scheduleId: string, day: string, startsAt: string, endsAt: string): CalendarEvent {
  return {
    id: `private-open:${scheduleId}:${day}`,
    kind: 'private-open',
    day,
    startsAt,
    endsAt,
    title: 'Private lesson — 30 min',
    coach: { id: 'coach-1', name: 'Dana Cole' },
    locationName: null,
    levelName: null,
    durationMinutes: 30,
    scheduleId,
    sessionId: null,
    price: 32.5,
    mine: false,
    students: [],
    isHoliday: false,
    holidayName: null,
  };
}

// The calendar's open slots (October is CDT, UTC-5: 4:30 PM = 21:30Z).
// Oct 6 has both times open; on Oct 13 the 5:00 slot is already taken.
const OPEN_EVENTS: CalendarEvent[] = [
  openEvent('sched-1', '2026-10-06', '2026-10-06T21:30:00.000Z', '2026-10-06T22:00:00.000Z'),
  openEvent('sched-2', '2026-10-06', '2026-10-06T22:00:00.000Z', '2026-10-06T22:30:00.000Z'),
  openEvent('sched-1', '2026-10-13', '2026-10-13T21:30:00.000Z', '2026-10-13T22:00:00.000Z'),
  openEvent('sched-thu', '2026-10-08', '2026-10-08T21:30:00.000Z', '2026-10-08T22:00:00.000Z'),
];

// Honors from/to like the real endpoint, so the wizard's paging to the
// horizon never sees an event twice.
function calendarResponse(url: URL, events: CalendarEvent[] = OPEN_EVENTS): CalendarResponse {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  return {
    from,
    to,
    horizonTo: '2026-12-06',
    events: events.filter((event) => event.day >= from && event.day <= to),
    coaches: [{ id: 'coach-1', name: 'Dana Cole' }],
  };
}

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
let calendarQueries: { coachId: string | null; type: string | null; from: string | null; to: string | null }[] = [];

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-schedules/public', () => HttpResponse.json(LESSONS)),
  http.get('*/calendar/public', ({ request }) => {
    const url = new URL(request.url);
    calendarQueries.push({
      coachId: url.searchParams.get('coachId'),
      type: url.searchParams.get('type'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    return HttpResponse.json(calendarResponse(url));
  }),
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

beforeAll(() => server.listen({ onUnhandledRequest }));
beforeEach(() => {
  global.Date = FrozenDate as DateConstructor;
});
afterEach(() => {
  global.Date = RealDate;
  server.resetHandlers();
  purchasePayload = null;
  creditPayload = null;
  calendarQueries = [];
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

async function walkToWhen(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/who is this for/i);
  await user.click(await screen.findByRole('radio', { name: /sam kid/i }));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText('Pick a date');
}

async function walkToSessions(user: ReturnType<typeof userEvent.setup>, time = '4:30 PM') {
  await walkToWhen(user);
  await user.click(await screen.findByRole('radio', { name: /tue, oct 6/i }));
  await user.click(screen.getByRole('radio', { name: time }));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/how many sessions/i);
}

describe('RegisterPrivatePage — book a private lesson', () => {
  it('Who -> a date and a time -> a 10-session pack -> Review -> Done, rendering every figure verbatim and posting the payload', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Dana Cole — Tuesdays · 4:30 PM–5:30 PM · 30-min lessons')).toBeInTheDocument();
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

    // The request names the picked slot and the pack, never a quantity or a price.
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

  // The reported bug: every date showed the one slot's 6 pm time, and other
  // times in the window were unreachable. Now: dates, then that date's times.
  describe('date first, then any open time in the window (bug fix)', () => {
    it("lists the window's open dates, then only that date's open times, and books the time picked", async () => {
      const user = userEvent.setup();
      renderPage();
      await walkToWhen(user);

      const dates = screen.getByRole('radiogroup', { name: 'Select a date' });
      expect(within(dates).getByRole('radio', { name: /tue, oct 6/i })).toHaveTextContent('2 open');
      expect(within(dates).getByRole('radio', { name: /tue, oct 13/i })).toHaveTextContent('1 open');
      // The coach's Thursday slot is another window — never offered here.
      expect(within(dates).queryByRole('radio', { name: /thu, oct 8/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Pick a time')).not.toBeInTheDocument();

      await user.click(within(dates).getByRole('radio', { name: /tue, oct 6/i }));
      const times = screen.getByRole('radiogroup', { name: 'Select a time' });
      expect(within(times).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['4:30 PM', '5:00 PM']);
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

      await user.click(within(times).getByRole('radio', { name: '5:00 PM' }));
      await user.click(screen.getByRole('button', { name: /continue/i }));
      await user.click(await screen.findByRole('radio', { name: /buy 1 session/i }));
      await user.click(screen.getByRole('button', { name: /continue/i }));
      // The review sentence names the time picked (the summary rail repeats it).
      expect(await screen.findByText('Tue, Oct 6, 2026, 5:00 PM', { selector: 'strong' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Pay $32.50 & book' }));

      await waitFor(() =>
        expect(purchasePayload).toEqual({ studentId: 'student-1', scheduleId: 'sched-2', day: '2026-10-06', contractId: 'contract-1' })
      );
    });

    it('a taken slot is not offered, and picking another date clears the chosen time', async () => {
      const user = userEvent.setup();
      renderPage();
      await walkToWhen(user);

      await user.click(screen.getByRole('radio', { name: /tue, oct 6/i }));
      await user.click(screen.getByRole('radio', { name: '5:00 PM' }));
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();

      await user.click(screen.getByRole('radio', { name: /tue, oct 13/i }));
      const times = screen.getByRole('radiogroup', { name: 'Select a time' });
      expect(within(times).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['4:30 PM']);
      expect(within(times).getByRole('radio', { name: '4:30 PM' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });

    it("asks the calendar for this coach's private slots, page by page, from today to the server's horizon", async () => {
      const user = userEvent.setup();
      renderPage();
      await walkToWhen(user);

      await waitFor(() =>
        expect(calendarQueries).toEqual([
          { coachId: 'coach-1', type: 'private', from: '2026-10-05', to: '2026-11-15' },
          { coachId: 'coach-1', type: 'private', from: '2026-11-16', to: '2026-12-27' },
        ])
      );
    });

    it('a calendar deep link (?slot=&day=) arrives with that date and time already picked', async () => {
      mockSearchParams = new URLSearchParams({ slot: 'sched-2', day: '2026-10-06', child: 'student-1' });
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: /continue/i }));
      expect(await screen.findByRole('radio', { name: /tue, oct 6/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: '5:00 PM' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    });
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

  it('shows a declined card (402) inline without crashing, refetches the open slots, and lets the parent pick another date', async () => {
    server.use(
      http.post('*/private-class-enrollments', () =>
        HttpResponse.json({ message: 'Your card was declined.' }, { status: 402 })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await walkToSessions(user);
    await user.click(screen.getByRole('radio', { name: /buy 1 session/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const fetchesBeforeSubmit = calendarQueries.length;
    await user.click(await screen.findByRole('button', { name: 'Pay $32.50 & book' }));

    expect(await screen.findByText(/your card was declined/i)).toBeInTheDocument();
    await waitFor(() => expect(calendarQueries.length).toBeGreaterThan(fetchesBeforeSubmit));

    await user.click(screen.getByRole('button', { name: /pick another date/i }));
    expect(await screen.findByText('Pick a date')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Pick a time')).not.toBeInTheDocument();
  });

  it('says so when the window has no open dates', async () => {
    server.use(http.get('*/calendar/public', ({ request }) => HttpResponse.json(calendarResponse(new URL(request.url), []))));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/who is this for/i);
    await user.click(await screen.findByRole('radio', { name: /sam kid/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/no open dates for these times/i)).toBeInTheDocument();
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

    // A slot id the public listing no longer carries — no window to book in.
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
