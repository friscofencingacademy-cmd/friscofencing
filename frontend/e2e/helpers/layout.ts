import { expect, type Page } from '@playwright/test';

// Layout assertions that only a real browser can make (jsdom has no layout).
// Ported from CKQ's e2e/helpers/layout.ts (docs/plans/testing-strategy-refresh-plan.md PR B).

/**
 * The page has no sideways scroll at the current viewport — zero tolerance:
 * any horizontal overflow on a phone is a layout bug, never a test to relax.
 * Call after the page has settled (a heading or other content is visible).
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });

  expect(
    overflow.scrollWidth - overflow.clientWidth,
    `page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`
  ).toBeLessThanOrEqual(0);
}
