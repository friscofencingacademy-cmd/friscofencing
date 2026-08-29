import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { mockApi } from './fixtures/mock-api';

// Logged-out marketing pages — zero real-browser coverage before this
// suite existed. A hydration/rendering break here is invisible to Jest's
// jsdom render (docs/plans/e2e-testing-plan.md's D4).
test.describe('public site (logged out)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test('home page renders without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Olympic Fencing.' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('/classes renders without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: 'Class Schedule' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('/coaches renders without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/coaches');
    await expect(page.getByRole('heading', { name: 'Coaching Staff' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  // Visual regression — static marketing content, so a diff here would be
  // a meaningful, low-noise signal (D8). SKIPPED, not deleted: Chromium's
  // font rendering differs enough between Windows/macOS/Linux that a
  // baseline has to be generated inside the exact environment CI runs in
  // (the Playwright Docker container, .github/workflows/ci.yml) to be
  // trustworthy — this build session had no Docker available to produce
  // one, so shipping a Windows-rendered baseline would just fail CI's
  // first run for the wrong reason (font rendering, not a real
  // regression). Un-skip once a real baseline is generated from that
  // container: `docker run --rm -v ${PWD}:/work -w /work/frontend
  // mcr.microsoft.com/playwright:v1.47.2-jammy npx playwright test
  // --update-snapshots -g "visual baseline"`, then commit the resulting
  // frontend/e2e/public-site.spec.ts-snapshots/*.png files.
  test.skip('home page visual baseline', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Olympic Fencing.' })).toBeVisible();
    await expect(page).toHaveScreenshot('home-page.png', { fullPage: true });
  });

  test.skip('/classes visual baseline', async ({ page }) => {
    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: 'Class Schedule' })).toBeVisible();
    await expect(page).toHaveScreenshot('classes-page.png', { fullPage: true });
  });

  // Accessibility — only serious/critical violations fail the build;
  // moderate/minor are logged, not failed, to avoid a noisy first run (D8).
  //
  // Both of this scan's original findings are now fixed at the source, not
  // ratcheted (see docs/TESTING_STRATEGY.md's "Known, accepted
  // accessibility findings" for the full history):
  // 1. LevelGrid's price text — gold #c8a000 on white (2.47:1) — fixed
  //    Phase 1 by the WP-alignment rebrand replacing gold with crimson
  //    (~6.7:1) (docs/plans/wordpress-ui-alignment-plan.md).
  // 2. Hero's temporary photo placeholder — muted text on border-gray
  //    (4.07:1), unmasked by fixing #1 (the old ratchet allowlisted the
  //    whole color-contrast RULE by id, silently hiding this one too) —
  //    fixed Phase 1 at the CSS level (.photoPlaceholder's background,
  //    ~5:1 now) AND made unreachable on this page Phase 2 (Hero no longer
  //    renders that element at all — see Hero.tsx).
  test('home page has no serious/critical accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Olympic Fencing.' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('/classes has no serious/critical accessibility violations', async ({ page }) => {
    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: 'Class Schedule' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
