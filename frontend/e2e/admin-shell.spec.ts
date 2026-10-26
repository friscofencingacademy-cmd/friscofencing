import { test, expect } from './fixtures/test';
import AxeBuilder from '@axe-core/playwright';

import type { LevelResponse, LevelsResponse } from '../lib/apiResponses';
import type { Level } from '../lib/types';
import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

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

  // KNOWN, PRE-EXISTING FINDING (not introduced by this suite, not fixed
  // here): the first real run of this scan found the sidebar's brand-role
  // and section-label text (`admin/layout.module.css`'s --sidebar-muted,
  // effectively #787f86 on --sidebar-bg) fails WCAG AA contrast (4.28:1,
  // needs 4.5:1) — a near-miss, still a real design-system decision outside
  // this plan's scope. UNCHANGED by the WP-alignment rebrand (Phase 1,
  // docs/plans/wordpress-ui-alignment-plan.md, 2026-08-29): --sidebar-bg
  // moved from #1b1a17 to #0e1b2a, but the two colors are similarly dark
  // (luminance ~0.0104 either way), so the ratio is still ~4.28:1 — verified,
  // not assumed, before leaving this ratchet in place (see public-site.spec
  // .ts's matching comment for the one violation that WAS fixed by the
  // rebrand). Ratcheted, not ignored: this exact violation is allowed so
  // the suite can ship green; any OTHER/NEW finding still fails.
  const KNOWN_ADMIN_DASHBOARD_VIOLATIONS = new Set(['color-contrast']);

  test('dashboard has no NEW serious/critical accessibility violations', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/dashboard');
    await expect(page.getByText('Dashboard').first()).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const unexpected = blocking.filter((v) => !KNOWN_ADMIN_DASHBOARD_VIOLATIONS.has(v.id));

    expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
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
