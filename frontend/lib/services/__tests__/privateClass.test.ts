import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  bookPrivateLessonWithCredit,
  cancelPrivateBooking,
  fetchPrivateAvailableDates,
  fetchPrivatePurchaseQuote,
  markPrivateAttendance,
  publishPrivateAvailability,
  purchasePrivateLessons,
  removePrivateAvailabilityRule,
} from '../privateClass';
import type { PrivatePurchaseQuote } from '../../types';

const QUOTE: PrivatePurchaseQuote = {
  durationMinutes: 30,
  hourlyRate: 65,
  availableCredits: 0,
  cancelCutoffHours: 24,
  options: [{ packId: null, unitPrice: 32.5, quantity: 1, subtotal: 32.5, savings: 0, total: 32.5 }],
};

let quoteParams: Record<string, string> = {};

const server = setupServer(
  http.get('*/private-class-enrollments/quote', ({ request }) => {
    quoteParams = Object.fromEntries(new URL(request.url).searchParams.entries());
    return HttpResponse.json(QUOTE);
  }),
  http.get('*/private-class-schedules/:id/available-dates', () => HttpResponse.json({ dates: [] })),
  http.delete('*/private-class-schedules/:id', () => HttpResponse.json({ outcome: 'retired' }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  quoteParams = {};
});
afterAll(() => server.close());

// docs/TESTING_STRATEGY.md's error-handling contract: queries throw,
// mutations never throw.
describe('privateClass service — queries throw on failure', () => {
  it('fetchPrivatePurchaseQuote sends studentId + scheduleId and resolves the server quote verbatim', async () => {
    await expect(fetchPrivatePurchaseQuote('student-1', 'sched-1')).resolves.toEqual(QUOTE);
    expect(quoteParams).toEqual({ studentId: 'student-1', scheduleId: 'sched-1' });
  });

  it.each([
    ['fetchPrivatePurchaseQuote', '*/private-class-enrollments/quote', () => fetchPrivatePurchaseQuote('s', 'r')],
    ['fetchPrivateAvailableDates', '*/private-class-schedules/:id/available-dates', () => fetchPrivateAvailableDates('r')],
  ])('%s rejects on a server error', async (_name, url, call) => {
    server.use(http.get(url, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    await expect(call()).rejects.toBeTruthy();
  });
});

describe('privateClass service — mutations resolve a status object, never throw', () => {
  it.each([
    ['purchasePrivateLessons', 'post', '*/private-class-enrollments', () =>
      purchasePrivateLessons({ studentId: 's', scheduleId: 'r', day: '2026-10-06', packId: 'pack-10' })],
    ['bookPrivateLessonWithCredit', 'post', '*/private-class-sessions', () =>
      bookPrivateLessonWithCredit({ studentId: 's', scheduleId: 'r', day: '2026-10-06' })],
    ['cancelPrivateBooking', 'post', '*/private-class-sessions/:id/cancel', () => cancelPrivateBooking('b')],
    ['markPrivateAttendance', 'patch', '*/private-class-sessions/:id/attendance', () => markPrivateAttendance('b', 'attended')],
    ['publishPrivateAvailability', 'post', '*/private-class-schedules', () =>
      publishPrivateAvailability({ daysOfWeek: [2], windowStart: '17:00', windowEnd: '18:00', startDate: '2026-10-01', endDate: '2026-10-31' })],
    ['removePrivateAvailabilityRule', 'delete', '*/private-class-schedules/:id', () => removePrivateAvailabilityRule('r')],
  ] as const)('%s returns the backend message on failure', async (_name, method, url, call) => {
    server.use(http[method](url, () => HttpResponse.json({ message: 'The server said no' }, { status: 409 })));

    await expect(call()).resolves.toEqual({ status: 'error', message: 'The server said no' });
  });

  it('purchasePrivateLessons falls back to a generic message when the server sends none', async () => {
    server.use(http.post('*/private-class-enrollments', () => new HttpResponse(null, { status: 500 })));

    await expect(
      purchasePrivateLessons({ studentId: 's', scheduleId: 'r', day: '2026-10-06' })
    ).resolves.toEqual({ status: 'error', message: 'Payment or booking failed. Please try again.' });
  });

  // docs/plans/coach-pack-pricing-plan.md D4 — the request names a pack by
  // id (or none, for a single session), never a quantity or a price.
  it('purchasePrivateLessons posts the packId as given, and nothing for a single session', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/private-class-enrollments', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ session: {}, remaining: 9 }, { status: 201 });
      })
    );

    await purchasePrivateLessons({ studentId: 's', scheduleId: 'r', day: '2026-10-06', packId: 'pack-10' });
    await purchasePrivateLessons({ studentId: 's', scheduleId: 'r', day: '2026-10-06' });

    expect(bodies).toEqual([
      { studentId: 's', scheduleId: 'r', day: '2026-10-06', packId: 'pack-10' },
      { studentId: 's', scheduleId: 'r', day: '2026-10-06' },
    ]);
  });

  it('removePrivateAvailabilityRule resolves the server outcome on success', async () => {
    await expect(removePrivateAvailabilityRule('rule-1')).resolves.toEqual({ status: 'success', data: 'retired' });
  });
});
