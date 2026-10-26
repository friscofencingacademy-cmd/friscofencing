import { test, expect } from './fixtures/test';

import type { PaymentHistoryResponse } from '../lib/apiResponses';
import type { PaymentHistoryRow } from '../lib/types';
import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';
import { expectNoBlockingA11yViolations } from './helpers/a11y';
import { expectNoHorizontalOverflow } from './helpers/layout';

// The parent's payment history (/parent/billing, docs/plans/payment-airtight-
// plan.md D10) in a real browser — the Jest page test's cases
// (app/parent/billing/__tests__/page.test.tsx) plus what jsdom cannot show:
// the real table layout on a phone and an accessibility scan. The page reads
// ONLY the Registration ledger (GET /registrations/history); every figure and
// description is the backend's, rendered verbatim.

const BREAKDOWN_NO_FEE = {
  monthlyFee: 150,
  prorated: false,
  proratedAmount: null,
  siblingDiscountApplied: false,
  siblingDiscountAmount: 0,
  registrationFeeCharged: 0,
};

const GROUP_ROW: PaymentHistoryRow = {
  _id: 'reg-1',
  billingShape: 'subscription_cycle',
  status: 'completed',
  amount: 175,
  chargeMethod: 'card',
  manualNote: null,
  paidAt: '2026-10-01T15:00:00.000Z',
  createdAt: '2026-10-01T15:00:00.000Z',
  studentName: 'Kid One',
  description: 'Group Class Registration — Beginner Foil (Beginner)',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  sessionDate: null,
  breakdown: { ...BREAKDOWN_NO_FEE, registrationFeeCharged: 25 },
  invoiceAvailable: true,
};

const MANUAL_ROW: PaymentHistoryRow = {
  ...GROUP_ROW,
  _id: 'reg-2',
  amount: 150,
  chargeMethod: 'manual',
  manualNote: 'Paid by check #1042',
  paidAt: '2026-09-01T15:00:00.000Z',
  createdAt: '2026-09-01T15:00:00.000Z',
  description: 'Group Class Renewal (Manual) — Beginner Foil (Beginner)',
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  breakdown: BREAKDOWN_NO_FEE,
};

const FAILED_ROW: PaymentHistoryRow = {
  ...GROUP_ROW,
  _id: 'reg-3',
  status: 'failed',
  amount: 150,
  paidAt: null,
  createdAt: '2026-10-20T15:00:00.000Z',
  description: 'Group Class Renewal — Beginner Foil (Beginner)',
  breakdown: BREAKDOWN_NO_FEE,
  invoiceAvailable: false,
};

const PRIVATE_ROW: PaymentHistoryRow = {
  ...GROUP_ROW,
  _id: 'reg-4',
  billingShape: 'per_session',
  amount: 65,
  paidAt: '2026-10-06T21:00:00.000Z',
  createdAt: '2026-10-06T21:00:00.000Z',
  description: 'Private Lesson with Dana Coach',
  periodStart: null,
  periodEnd: null,
  sessionDate: '2026-10-06T21:00:00.000Z',
  breakdown: null,
};

const HISTORY: MockRule = {
  method: 'GET',
  path: '/registrations/history',
  handler: (route) =>
    json<PaymentHistoryResponse>(route, 200, { history: [GROUP_ROW, MANUAL_ROW, FAILED_ROW, PRIVATE_ROW] }),
};

// Every date on the page is a fixed fixture, but pin the clock anyway so
// nothing "relative to today" can drift (docs/TESTING_STRATEGY.md).
const NOW = new Date('2026-10-26T15:00:00.000Z');

function rowFor(page: import('@playwright/test').Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

test.describe('parent payment history', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await loginAs(page, 'parent', [HISTORY]);
    await page.goto('/parent/billing');
    await expect(page.getByText('Group Class Registration — Beginner Foil (Beginner)')).toBeVisible();
  });

  test('shows one row per ledger entry across billing shapes, with the backend amount and status', async ({ page }) => {
    const paid = rowFor(page, 'Group Class Registration — Beginner Foil (Beginner)');
    await expect(paid).toContainText('$175.00');
    await expect(paid).toContainText('Paid');

    await expect(rowFor(page, 'Private Lesson with Dana Coach')).toContainText('$65.00');
  });

  test('marks a manually recorded payment with a Manual chip and its note', async ({ page }) => {
    const manual = rowFor(page, 'Paid by check #1042');
    await expect(manual).toContainText('Manual');
    await expect(manual).toContainText('$150.00');
  });

  test('a failed charge shows Failed and offers no invoice download', async ({ page }) => {
    const failed = rowFor(page, 'Group Class Renewal — Beginner Foil (Beginner)');
    await expect(failed).toContainText('Failed');
    await expect(failed.getByRole('link', { name: /download/i })).toHaveCount(0);
  });

  test("a completed charge's download link points at that row's invoice endpoint", async ({ page }) => {
    const paid = rowFor(page, 'Group Class Registration — Beginner Foil (Beginner)');
    await expect(paid.getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      '/api/v1/registrations/reg-1/invoice'
    );
  });

  test('has no serious/critical accessibility violations and no sideways scroll', async ({ page }) => {
    await expectNoBlockingA11yViolations(page);

    await expectNoHorizontalOverflow(page);
  });
});
