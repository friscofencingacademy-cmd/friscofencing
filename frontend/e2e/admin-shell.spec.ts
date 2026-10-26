import { test, expect } from './fixtures/test';

import type { LevelResponse, LevelsResponse } from '../lib/apiResponses';
import type { Level } from '../lib/types';
import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';
import { expectNoBlockingA11yViolations } from './helpers/a11y';

// AppShell/the admin sidebar has zero direct test coverage today
// (docs/TEST_COVERAGE.md's own documented gap) — this is the cheapest
// real-browser proof the admin shell itself renders and navigates
// (docs/plans/e2e-testing-plan.md's D4).
test.describe('admin shell', () => {
  test('sidebar renders expected nav sections for an admin', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/dashboard');

    const sidebar = page.getByRole('navigation', { name: 'Admin sidebar' });
    await expect(sidebar).toBeVisible();
    for (const label of ['Dashboard', 'Users', 'Classes', 'Levels', 'Holidays', 'Subscriptions', 'Audits']) {
      await expect(sidebar.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('a non-admin role is redirected away from the admin shell', async ({ page }) => {
    // student, not parent/coach: student's own ROLE_LANDING_PATH IS '/', so
    // this settles in one redirect. A parent/coach would bounce twice (the
    // admin shell sends them to '/', then home's own redirect immediately
    // sends them on to their real dashboard) — real, correct behavior, just
    // the wrong choice for isolating "the admin shell itself gates roles."
    await loginAs(page, 'student');
    await page.goto('/admin/dashboard');

    await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });
  });

  // docs/plans/kiosk-signin-plan.md K2 — the front-desk tablet's login must
  // never get into the admin shell. It is bounced to '/', whose own redirect
  // sends a kiosk login on to /kiosk.
  test('the kiosk login is kept out of the admin shell and ends up on /kiosk', async ({ page }) => {
    await loginAs(page, 'kiosk');
    await page.goto('/admin/dashboard');

    await page.waitForURL((url) => url.pathname === '/kiosk', { timeout: 10_000 });
    await expect(page.getByRole('navigation', { name: 'Admin sidebar' })).toHaveCount(0);
    await expect(page.getByTestId('roster-search')).toBeVisible();
  });

  // The sidebar's one known contrast finding is ratcheted by node in
  // helpers/a11y.ts — the one home for it (docs/TESTING_STRATEGY.md).
  test('dashboard has no NEW serious/critical accessibility violations', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/dashboard');
    await expect(page.getByText('Dashboard').first()).toBeVisible();

    await expectNoBlockingA11yViolations(page);
  });

  test('Levels: create, edit, and delete round-trip against mocked responses', async ({ page }) => {
    let levels: Level[] = [{ _id: 'level-a', name: 'Fencing Foundation', order: 1 }];

    const overrides: MockRule[] = [
      { method: 'GET', path: '/levels', handler: (route) => json<LevelsResponse>(route, 200, { levels }) },
      {
        method: 'POST',
        path: '/levels',
        handler: (route) => {
          const created: Level = { _id: 'level-new', name: 'Advanced Fencing', order: 2 };
          levels = [...levels, created];
          return json<LevelResponse>(route, 201, { level: created });
        },
      },
      {
        method: 'PUT',
        path: '/levels/:id',
        handler: (route, { params }) => {
          levels = levels.map((l) => (l._id === params.id ? { ...l, name: 'Advanced Fencing (Updated)' } : l));
          const updated = levels.find((l) => l._id === params.id);
          if (!updated) throw new Error(`PUT /levels/${params.id}: no such level in this test's mock state`);
          return json<LevelResponse>(route, 200, { level: updated });
        },
      },
      {
        method: 'DELETE',
        path: '/levels/:id',
        handler: (route, { params }) => {
          levels = levels.filter((l) => l._id !== params.id);
          return route.fulfill({ status: 204 });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);

    await page.goto('/admin/levels');
    await expect(page.getByText('Fencing Foundation')).toBeVisible();

    // Create
    await page.getByRole('button', { name: /add level/i }).click();
    await page.getByLabel('Name').fill('Advanced Fencing');
    await page.getByLabel('Order').fill('2');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Advanced Fencing', { exact: true })).toBeVisible();

    // Edit
    await page.getByRole('button', { name: 'Edit Advanced Fencing' }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Advanced Fencing (Updated)')).toBeVisible();

    // Delete
    await page.getByRole('button', { name: 'Delete Advanced Fencing (Updated)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Advanced Fencing (Updated)')).toHaveCount(0);
  });
});
