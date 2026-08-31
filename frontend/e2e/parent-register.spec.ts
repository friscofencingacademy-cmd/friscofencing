// If you change this wizard's DOM/labels, also update:
//   audit/scenarios/s2-registration.js + audit/lib/register-child.js (live-audit twin)
// (docs/plans/e2e-testing-plan.md's D9 — three places independently encode
// this wizard's DOM; a change here without the others is how this drifted
// stale before.)

import { test, expect } from '@playwright/test';

import { mockApi, json, FIXTURE_GROUP_CLASS_A, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

// Directly reproduces this session's two real breaks (docs/plans/
// e2e-testing-plan.md's D4): the register wizard's "Continue" button was
// removed when the wizard steps were merged (picking a child now
// auto-advances; the level/date step's CTA goes straight to "Register &
// Pay"), and the date-pill picker's accessible group name was renamed from
// "Select a time" to "Select a start date". Both real UI states the wizard
// can be in (D5) are covered on purpose, via a frozen clock, rather than
// depending on whatever day this happens to run.
//
// The wizard was restructured again (docs/plans/booking-flow-sequential-
// plan.md): every section (Who -> Level -> Start date -> Payment) now
// renders sequentially in one column, all at once as each prerequisite
// selection is made — there is no "step" to advance through at all, and the
// CTA is always "Register & Pay". A "Continue" button (or any other
// intermediate CTA) reappearing here would be a REGRESSION, not a fix — do
// not add one back.

function sessionsFixture(dates: string[]) {
  return {
    method: 'GET',
    path: `/group-class-sessions/by-class/${FIXTURE_GROUP_CLASS_A._id}`,
    handler: (route) =>
      json(route, 200, {
        sessions: dates.map((date, i) => ({
          _id: `session-${i}`,
          scheduleId: { _id: 'schedule-a', dayOfWeek: 2, startTime: '16:00', endTime: '17:00' },
          date,
        })),
      }),
  } satisfies MockRule;
}

test.describe('parent register wizard', () => {
  test('this-month pill row: pick a child, level, date, and pay', async ({ page }) => {
    // Mid-month — well clear of both the 14-day and month-end edges, so the
    // "this month" pill row is the state under test here.
    await page.clock.setFixedTime(new Date('2025-03-05T12:00:00.000Z'));

    await loginAs(page, 'parent', [sessionsFixture(['2025-03-10T21:00:00.000Z'])]);

    await page.goto('/parent/register');

    await page.getByRole('radio', { name: /test child/i }).click();
    // No "Continue" click here — the Level section is already on screen,
    // sequentially, the moment a child is picked. If a "Continue" step ever
    // comes back, this spec will hang here and fail loudly rather than
    // silently pass.
    await page.getByRole('radio', { name: /fencing foundation/i }).click();

    const dateGroup = page.getByRole('radiogroup', { name: 'Select a start date' });
    await expect(dateGroup).toBeVisible();
    await dateGroup.getByRole('radio').first().click();

    await expect(page.getByText(/card on file/i)).toBeVisible();
    await page.getByRole('button', { name: /register & pay/i }).click();

    await expect(page.getByText('Registration complete!')).toBeVisible();
  });

  test('no this-month session: falls back to "Enroll for next month"', async ({ page }) => {
    // Late in the month — the schedule's only upcoming occurrence (a
    // Tuesday) rolls past month-end, so thisMonthWindowEnd() caps below it
    // and the pill row never renders (the exact staging condition found
    // 2026-08-28). This is the state a mocked suite can pin on purpose,
    // rather than stumbling into only near the real end of a real month.
    await page.clock.setFixedTime(new Date('2025-03-28T12:00:00.000Z'));

    await loginAs(page, 'parent', [sessionsFixture(['2025-04-01T21:00:00.000Z'])]);

    await page.goto('/parent/register');

    await page.getByRole('radio', { name: /test child/i }).click();
    await page.getByRole('radio', { name: /fencing foundation/i }).click();

    await expect(page.getByText(/no class dates available/i)).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Select a start date' })).toHaveCount(0);

    const enrollNextMonth = page.getByRole('button', { name: /enroll for next month/i });
    await expect(enrollNextMonth).toBeEnabled();
    await enrollNextMonth.click();

    await expect(page.getByText(/card on file/i)).toBeVisible();
    await page.getByRole('button', { name: /register & pay/i }).click();

    await expect(page.getByText('Registration complete!')).toBeVisible();
  });

  test('a declined registration charge shows "Registration received", never an error', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2025-03-05T12:00:00.000Z'));

    const overrides: MockRule[] = [
      sessionsFixture(['2025-03-10T21:00:00.000Z']),
      {
        method: 'POST',
        path: '/registrations',
        handler: (route) =>
          json(route, 201, {
            chargeAmount: 100,
            totalChargeAmount: 100,
            paymentStatus: 'pending',
            siblingDiscountApplied: false,
            siblingDiscountAmount: 0,
            siblingDiscountReason: null,
            registrationFeeCharged: 0,
            registrationFeeWaived: true,
            registrationFeeReason: 'Waived',
            prorated: false,
            totalClassDays: null,
            remainingClassDays: null,
            dailyRate: null,
            periodEnd: new Date('2025-04-01T00:00:00.000Z').toISOString(),
          }),
      },
    ];
    await loginAs(page, 'parent', overrides);

    await page.goto('/parent/register');
    await page.getByRole('radio', { name: /test child/i }).click();
    await page.getByRole('radio', { name: /fencing foundation/i }).click();
    await page.getByRole('radiogroup', { name: 'Select a start date' }).getByRole('radio').first().click();
    await page.getByRole('button', { name: /register & pay/i }).click();

    await expect(page.getByText('Registration received')).toBeVisible();
    await expect(page.getByText(/we'll automatically retry/i)).toBeVisible();
    await expect(page.getByText('Registration complete!')).toHaveCount(0);
  });
});
