import { test, expect, type Page } from '@playwright/test';

import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

// The front-desk sign-in tablet end to end (docs/plans/kiosk-signin-plan.md
// K7): logged in as the `kiosk` account, a student types their name, confirms,
// sees the signed-in card, and the tablet returns to the search by itself.
// Every request is mocked; the sign-in body is asserted exactly.

const SIGNED_IN = {
  student: { _id: 'student-ava', firstName: 'Ava', lastName: 'Student' },
  session: { _id: 'session-1', className: 'Fencing Foundation', startTime: '16:00', endTime: '17:00', coachName: 'Cora Coach' },
  alreadySignedIn: false,
};

function signInRule(onBody: (body: unknown) => void, respond: MockRule['handler'] = (route) => json(route, 200, SIGNED_IN)): MockRule {
  return {
    method: 'POST',
    path: '/kiosk/sign-in',
    handler: (route, ctx) => {
      onBody(JSON.parse(route.request().postData() ?? '{}'));
      return respond(route, ctx);
    },
  };
}

async function findAva(page: Page) {
  await page.goto('/kiosk');
  await expect(page.getByText('Type your name to sign in.')).toBeVisible();
  await page.getByTestId('roster-search').fill('av');
  await expect(page.getByTestId('roster-row')).toHaveCount(2);
  await page.getByTestId('roster-search').fill('ava');
  await page.getByText('Ava Student').click();
}

test.describe('kiosk sign-in', () => {
  test('type, confirm, signed in, then back to the search by itself', async ({ page }) => {
    const bodies: unknown[] = [];
    await page.clock.install();
    await loginAs(page, 'kiosk', [signInRule((body) => bodies.push(body))]);

    await findAva(page);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Are you Ava Student?');
    await page.getByRole('button', { name: "Yes, that's me" }).click();

    await expect(page.getByText('Ava Student signed in')).toBeVisible();
    await expect(page.getByText('Fencing Foundation · 4:00 PM–5:00 PM')).toBeVisible();
    expect(bodies).toEqual([{ studentId: 'student-ava' }]);

    await page.clock.runFor(5000);
    await expect(page.getByTestId('roster-search')).toHaveValue('');
    await expect(page.getByText('Ava Student signed in')).toHaveCount(0);
  });

  test('signs in on the first tap when confirmation is switched off', async ({ page }) => {
    const bodies: unknown[] = [];
    await loginAs(page, 'kiosk', [
      signInRule((body) => bodies.push(body)),
      {
        method: 'GET',
        path: '/kiosk/state',
        handler: (route) =>
          json(route, 200, {
            students: [{ studentId: 'student-ava', firstName: 'Ava', lastName: 'Student', levelName: null }],
            confirmationRequired: false,
            serverTime: '2026-09-30T20:00:00.000Z',
          }),
      },
    ]);

    await page.goto('/kiosk');
    await page.getByTestId('roster-search').fill('ava');
    await page.getByText('Ava Student').click();

    await expect(page.getByText('Ava Student signed in')).toBeVisible();
    await expect(page.getByText(/are you/i)).toHaveCount(0);
    expect(bodies).toEqual([{ studentId: 'student-ava' }]);
  });

  test("shows the backend's message when the class is over, and the search still works", async ({ page }) => {
    await loginAs(page, 'kiosk', [
      signInRule(
        () => {},
        (route) => json(route, 409, { message: "Ava's class today has already ended" })
      ),
    ]);

    await findAva(page);
    await page.getByRole('button', { name: "Yes, that's me" }).click();

    // Filtered by text: Next.js also renders its own role="alert" route announcer.
    await expect(page.getByRole('alert').filter({ hasText: "Ava's class today has already ended" })).toBeVisible();
    await page.getByTestId('roster-search').fill('cal');
    await expect(page.getByText('Cal Brown')).toBeVisible();
  });
});
