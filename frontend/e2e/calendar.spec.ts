import { test, expect } from './fixtures/test';
import AxeBuilder from '@axe-core/playwright';

import { mockApi, CALENDAR_NOW, FIXTURE_CALENDAR_COACH_PRIVATE } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

// The public calendar in a real browser (docs/plans/calendar-view-plan.md
// §2.5): filtering, the click through login into the existing booking wizard
// with the date already picked, and an accessibility scan. The clock is
// pinned so the default month is always October 2026.
//
// Below 768 px the calendar opens in the List view by design (design-system
// "Calendar", C10), so the month-grid tests ask for the Month view in the URL —
// the same choice the Month/List toggle makes — and run on a phone too. The
// phone default itself has its own test, which pins a phone width.
const MONTH_VIEW = '/calendar?view=month';
const WIZARD_LINK = '/parent/register-private?slot=private-rule-1&day=2026-10-06';

function dayCell(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('cell', { name: new RegExp(name) });
}

test.describe('calendar (logged out)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(CALENDAR_NOW);
    await mockApi(page);
  });

  test('renders October with a class and an open slot, without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(MONTH_VIEW);

    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    await expect(dayCell(page, 'Tuesday, October 6').getByText('Open slot')).toBeVisible();
    await expect(dayCell(page, 'Wednesday, October 7').getByText('Class')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('filtering by coach keeps it in the URL and shows only that coach', async ({ page }) => {
    await page.goto(MONTH_VIEW);
    await expect(dayCell(page, 'Wednesday, October 7').getByText('Class')).toBeVisible();

    await page.getByRole('combobox', { name: 'Coach' }).selectOption({ label: FIXTURE_CALENDAR_COACH_PRIVATE.name });

    await expect(page).toHaveURL(new RegExp(`coach=${FIXTURE_CALENDAR_COACH_PRIVATE.id}`));
    await expect(dayCell(page, 'Tuesday, October 6').getByText('Open slot')).toBeVisible();
    await expect(dayCell(page, 'Wednesday, October 7').getByText('Class')).toHaveCount(0);
  });

  test('clicking an open slot goes to log in, carrying the wizard link with the slot and its day', async ({ page }) => {
    await page.goto(MONTH_VIEW);

    await dayCell(page, 'Tuesday, October 6').getByRole('link', { name: /Open slot, 4:30 PM/ }).click();

    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(WIZARD_LINK);
  });

  test('opens in the List view on a phone, showing the same events by day', async ({ page }) => {
    // The List-by-default rule applies below 768 px — pinned, so this runs on every project.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/calendar');

    await expect(page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const tuesday = page.getByRole('region', { name: 'Tuesday, October 6' });
    await expect(tuesday.getByRole('link', { name: /Open slot, 4:30 PM/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Wednesday, October 7' }).getByText('Class')).toBeVisible();
    await expect(page.getByRole('cell')).toHaveCount(0);
  });

  // Zero tolerance, like the other public pages (public-site.spec.ts).
  test('/calendar has no serious/critical accessibility violations, in both views', async ({ page }) => {
    await page.goto(MONTH_VIEW);
    await expect(dayCell(page, 'Tuesday, October 6').getByText('Open slot')).toBeVisible();

    const month = await new AxeBuilder({ page }).analyze();
    const monthBlocking = month.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(monthBlocking, JSON.stringify(monthBlocking, null, 2)).toEqual([]);

    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.getByRole('heading', { name: 'Tuesday, October 6' })).toBeVisible();

    const list = await new AxeBuilder({ page }).analyze();
    const listBlocking = list.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(listBlocking, JSON.stringify(listBlocking, null, 2)).toEqual([]);
  });
});

test.describe('calendar (parent)', () => {
  test('clicking an open slot opens the booking wizard with that date already picked', async ({ page }) => {
    await page.clock.setFixedTime(CALENDAR_NOW);
    await loginAs(page, 'parent');

    await page.goto(MONTH_VIEW);
    await dayCell(page, 'Tuesday, October 6').getByRole('link', { name: /Open slot, 4:30 PM/ }).click();

    await expect(page).toHaveURL(new RegExp(WIZARD_LINK.replace(/[?]/g, '\\?')));
    await page.getByRole('radio', { name: /test child/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('radio', { name: /tue, oct 6/i })).toBeChecked();
  });
});
