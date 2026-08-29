import { test, expect } from '@playwright/test';

import { mockApi, json, type MockRule } from './fixtures/mock-api';
import { ROLE_LANDING_PATH, type Role } from './fixtures/auth';

// The only real, unmocked-at-the-UI-level coverage of the login form + the
// role-based redirect anywhere in the test pyramid (docs/plans/
// e2e-testing-plan.md's D3) — every other spec skips straight past this via
// fixtures/auth.ts's loginAs(). Real form, real submit, real Next.js
// client-side navigation; only the network is mocked.
const ROLES: Role[] = ['student', 'parent', 'coach', 'admin', 'superadmin'];

for (const role of ROLES) {
  test(`logs in as ${role} and lands on ${ROLE_LANDING_PATH[role]}`, async ({ page }) => {
    const user = {
      _id: `user-${role}`,
      role,
      firstName: 'Test',
      lastName: role,
      email: `${role}@example.com`,
    };

    const overrides: MockRule[] = [
      { method: 'POST', path: '/auth/login', handler: (route) => json(route, 200, { user }) },
      // Once logged in, subsequent page loads' restoreSession() calls
      // should also see this user — matters for the admin/coach/parent
      // landing pages, which each re-check auth on mount.
      { method: 'GET', path: '/auth/me', handler: (route) => json(route, 200, { user }) },
    ];
    await mockApi(page, overrides);

    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log In' }).click();

    await page.waitForURL((url) => url.pathname === ROLE_LANDING_PATH[role], { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`${ROLE_LANDING_PATH[role].replace('/', '\\/')}$`));
  });
}

test('shows a clean error on a declined login, never a raw error', async ({ page }) => {
  const overrides: MockRule[] = [
    {
      method: 'POST',
      path: '/auth/login',
      handler: (route) => json(route, 401, { message: 'Invalid email or password.' }),
    },
  ];
  await mockApi(page, overrides);

  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log In' }).click();

  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
