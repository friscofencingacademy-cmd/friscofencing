import { test, expect } from './fixtures/test';

import type { ApiErrorResponse, MyPrivateBookingsResponse } from '../lib/apiResponses';
import type { PrivateAttendanceResult, PrivateBookingResult, PrivatePurchaseQuote } from '../lib/types';
import { json, CALENDAR_NOW, FIXTURE_PRIVATE_BOOKING, FIXTURE_PRIVATE_QUOTE, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

// Private lessons, end to end in a real browser (docs/decisions/011-private-
// per-session-booking.md): the public listing into the booking wizard, both
// ways to pay, and the coach recording attendance. Network fully mocked
// (fixtures/mock-api.ts) — the real backend flow is covered by the backend
// route suites against real Stripe test mode.
test.describe('private lesson booking', () => {
  // The wizard lists open slots from today to the booking horizon — pin
  // "today" to CALENDAR_NOW (Mon Oct 5 2026) so the fixture's Tue Oct 6 slot
  // is ahead of it.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(CALENDAR_NOW);
  });

  test("a parent picks a window, a date, a time and the coach's 10-session pack, pays the pack price, and is booked", async ({ page }) => {
    let purchasePayload: unknown = null;
    const overrides: MockRule[] = [
      {
        method: 'POST',
        path: '/private-class-enrollments',
        handler: (route) => {
          purchasePayload = JSON.parse(route.request().postData() ?? '{}');
          return json<PrivateBookingResult>(route, 201, { session: FIXTURE_PRIVATE_BOOKING, remaining: 9 });
        },
      },
    ];
    await loginAs(page, 'parent', overrides);

    await page.goto('/private-classes');
    await expect(page.getByText('Tuesdays · 4:30 PM–5:00 PM · 30-min lessons')).toBeVisible();
    await expect(page.getByText('Packs: 10 lessons for $300.00')).toBeVisible();
    await page.getByRole('link', { name: 'Pick a date' }).click();

    await expect(page).toHaveURL(/\/parent\/register-private\?slot=private-rule-1/);
    await page.getByRole('radio', { name: /test child/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // A date first, then a time on that date.
    await page.getByRole('radio', { name: /tue, oct 6/i }).click();
    await page.getByRole('radio', { name: '4:30 PM' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('radio', { name: /buy 10 sessions/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText(/cancel at least 24 hours before a lesson/i)).toBeVisible();
    await expect(page.getByText('Pack savings')).toBeVisible();
    await page.getByRole('button', { name: 'Pay $300.00 & book' }).click();

    await expect(page.getByText("You're booked!")).toBeVisible();
    // The request names the pack by id and the quoted contract version —
    // never a quantity or a price.
    expect(purchasePayload).toEqual({
      studentId: 'student-1',
      scheduleId: 'private-rule-1',
      day: '2026-10-06',
      contractId: 'private-contract-1',
      packId: 'private-pack-10',
    });
  });

  test('a parent with paid sessions books with one — no card charge', async ({ page }) => {
    let creditPayload: unknown = null;
    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: '/private-class-enrollments/quote',
        handler: (route) => json<PrivatePurchaseQuote>(route, 200, { ...FIXTURE_PRIVATE_QUOTE, availableCredits: 3 }),
      },
      {
        method: 'POST',
        path: '/private-class-sessions',
        handler: (route) => {
          creditPayload = JSON.parse(route.request().postData() ?? '{}');
          return json<PrivateBookingResult>(route, 201, { session: FIXTURE_PRIVATE_BOOKING, remaining: 2 });
        },
      },
    ];
    await loginAs(page, 'parent', overrides);

    await page.goto('/parent/register-private?slot=private-rule-1&child=student-1&day=2026-10-06');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('radio', { name: /use a paid session/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/no card charge/i)).toBeVisible();
    await page.getByRole('button', { name: 'Book with a paid session' }).click();

    await expect(page.getByText("You're booked!")).toBeVisible();
    expect(creditPayload).toEqual({ studentId: 'student-1', scheduleId: 'private-rule-1', day: '2026-10-06' });
  });

  // The backend's atomic slot claim refuses a date another family just took
  // (privateClassSession.service.js's SLOT_TAKEN_MESSAGE). Nothing is charged
  // or booked: the wizard shows the server's message, refetches the dates and
  // sends the parent back to pick another one.
  test('a slot taken mid-checkout shows the server message, books nothing, and sends the parent back to pick another date', async ({ page }) => {
    // Open slots come from the calendar (the default mock serves them); count
    // its requests to prove the wizard refetches after the refusal.
    let dateFetches = 0;
    page.on('request', (request) => {
      if (request.url().includes('/calendar/public')) dateFetches += 1;
    });
    const overrides: MockRule[] = [
      {
        method: 'POST',
        path: '/private-class-enrollments',
        handler: (route) =>
          json<ApiErrorResponse>(route, 409, { message: 'This time slot was just taken — please pick another' }),
      },
    ];
    await loginAs(page, 'parent', overrides);

    await page.goto('/parent/register-private?slot=private-rule-1&child=student-1&day=2026-10-06');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /buy 10 sessions/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    const fetchesBeforePay = dateFetches;
    await page.getByRole('button', { name: 'Pay $300.00 & book' }).click();

    await expect(page.getByText('This time slot was just taken — please pick another')).toBeVisible();
    await expect(page.getByText("You're booked!")).toHaveCount(0);
    await expect.poll(() => dateFetches).toBeGreaterThan(fetchesBeforePay);

    await page.getByRole('button', { name: /pick another date/i }).click();
    await expect(page.getByRole('radio', { name: /tue, oct 6/i })).toBeVisible();
  });

  test('a coach marks a started private lesson attended', async ({ page }) => {
    let attendancePayload: unknown = null;
    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: '/private-class-sessions/mine',
        handler: (route, { url }) =>
          json<MyPrivateBookingsResponse>(route, 200, {
            sessions:
              url.searchParams.get('window') === 'unmarked'
                ? [
                    {
                      ...FIXTURE_PRIVATE_BOOKING,
                      studentId: { _id: 'student-1', firstName: 'Test', lastName: 'Child' },
                      parentId: { _id: 'user-parent', firstName: 'Test', lastName: 'Parent' },
                      attendance: 'scheduled',
                      canCancel: false,
                    },
                  ]
                : [],
          }),
      },
      {
        method: 'PATCH',
        path: `/private-class-sessions/${FIXTURE_PRIVATE_BOOKING._id}/attendance`,
        handler: (route) => {
          attendancePayload = JSON.parse(route.request().postData() ?? '{}');
          return json<PrivateAttendanceResult>(route, 200, { session: { ...FIXTURE_PRIVATE_BOOKING, attendance: 'attended' } });
        },
      },
    ];
    await loginAs(page, 'coach', overrides);

    await page.goto('/coach/private-students');
    await expect(page.getByText('Test Child')).toBeVisible();
    await page.getByRole('button', { name: 'Attended' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

    await expect.poll(() => attendancePayload).toEqual({ status: 'attended' });
  });
});
