import { test, expect } from './fixtures/test';

import type { AdminSubscriptionResponse, GroupClassSchedulesResponse, GroupClassesResponse, IgnoredBodyResponse, MySubscriptionsResponse } from '../lib/apiResponses';
import type {
  AdminSubscriptionListResponse,
  AdminSubscriptionRow,
  ChargePreview,
  ChargeResult,
  GroupClass,
  GroupClassSchedule,
  Subscription,
} from '../lib/types';
import { json, FIXTURE_LEVEL_A, FIXTURE_LEVEL_B, FIXTURE_LOCATION, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';
import { expectNoBlockingA11yViolations } from './helpers/a11y';
import { expectNoHorizontalOverflow } from './helpers/layout';

// Group-class subscriptions in a real browser — the parent's own page
// (app/parent/subscriptions) and the admin page (app/admin/subscriptions),
// mirroring their Jest tests' cases. Every request a mutation sends is
// asserted exactly; every figure shown is the backend's (CLAUDE.md hard
// rule 7). Clock pinned so no date on either page drifts.

const NOW = new Date('2026-10-26T15:00:00.000Z');

// ── Parent ────────────────────────────────────────────────────────────────

const PARENT_SCHEDULE: GroupClassSchedule = {
  _id: 'sched-1',
  classId: 'class-a',
  coachId: 'coach-a',
  dayOfWeek: 3,
  startTime: '16:00',
  endTime: '17:00',
  students: ['student-1'],
};

const PARENT_SUBSCRIPTION: Subscription = {
  _id: 'sub-1',
  studentId: { _id: 'student-1', firstName: 'Kid', lastName: 'One' },
  scheduleId: PARENT_SCHEDULE,
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  nextBillingDate: '2026-11-01T00:00:00.000Z',
  lastChargeAmount: 150,
  lastPayment: { amount: 150, paidAt: '2026-10-01T12:00:00.000Z', chargeMethod: 'card' },
};

test.describe('parent subscriptions', () => {
  test('cancelling posts to that subscription and the row then says it cancels at period end', async ({ page }) => {
    let cancelled = false;
    let cancelBody: string | null = 'not sent';
    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: '/registrations/mine',
        handler: (route) =>
          json<MySubscriptionsResponse>(route, 200, {
            subscriptions: [{ ...PARENT_SUBSCRIPTION, cancelAtPeriodEnd: cancelled }],
          }),
      },
      {
        method: 'POST',
        path: '/subscriptions/:id/cancel',
        handler: (route, { params }) => {
          expect(params.id).toBe('sub-1');
          cancelBody = route.request().postData();
          cancelled = true;
          return json<IgnoredBodyResponse>(route, 200, {});
        },
      },
    ];
    await page.clock.setFixedTime(NOW);
    await loginAs(page, 'parent', overrides);
    await page.goto('/parent/subscriptions');

    const row = page.getByRole('row').filter({ hasText: 'Kid One' });
    await expect(row).toContainText('$150.00');
    await expectNoBlockingA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await row.getByRole('button', { name: /^cancel$/i }).click();

    await expect(row).toContainText(/cancels at end of current period/i);
    await expect(row.getByRole('button', { name: /^cancel$/i })).toHaveCount(0);
    expect(cancelBody).toBeNull();
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────

const CLASS_A: GroupClass = { _id: 'class-a', name: 'Beginner Foil A', levelId: FIXTURE_LEVEL_A._id, locationId: FIXTURE_LOCATION._id, capacity: 10 };
const CLASS_B: GroupClass = { _id: 'class-b', name: 'Beginner Foil B', levelId: FIXTURE_LEVEL_A._id, locationId: FIXTURE_LOCATION._id, capacity: 10 };
const CLASS_C: GroupClass = { _id: 'class-c', name: 'Advanced Epee', levelId: FIXTURE_LEVEL_B._id, locationId: FIXTURE_LOCATION._id, capacity: 10 };

const SCHEDULE_A: GroupClassSchedule = { _id: 'sched-a', classId: 'class-a', coachId: 'coach-a', dayOfWeek: 1, startTime: '16:00', endTime: '17:00', students: ['student-1'] };
const SCHEDULE_B: GroupClassSchedule = { _id: 'sched-b', classId: 'class-b', coachId: 'coach-b', dayOfWeek: 3, startTime: '17:00', endTime: '18:00', students: [] };
const SCHEDULE_C: GroupClassSchedule = { _id: 'sched-c', classId: 'class-c', coachId: 'coach-c', dayOfWeek: 4, startTime: '18:00', endTime: '19:00', students: [] };

function adminRow(overrides: Partial<AdminSubscriptionRow> = {}): AdminSubscriptionRow {
  return {
    _id: 'sub-1',
    studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Rivera' },
    parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Rivera', email: 'pat@example.com' },
    scheduleId: {
      _id: 'sched-a',
      classId: { _id: 'class-a', name: 'Beginner Foil A', levelId: FIXTURE_LEVEL_A, locationId: FIXTURE_LOCATION, capacity: 10 },
      coachId: { _id: 'coach-a', firstName: 'Coach', lastName: 'A', email: 'coacha@example.com' },
      dayOfWeek: 1,
      startTime: '16:00',
      endTime: '17:00',
      students: ['student-1'],
    },
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: '2026-10-01T00:00:00.000Z',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    nextBillingDate: '2026-11-01T00:00:00.000Z',
    lastChargeAmount: 150,
    lastSiblingDiscountApplied: false,
    lastPayment: { amount: 150, paidAt: '2026-10-01T12:00:00.000Z', chargeMethod: 'card' },
    ...overrides,
  };
}

const PENDING_CANCEL_ROW = adminRow({
  _id: 'sub-2',
  studentId: { _id: 'student-2', firstName: 'Lee', lastName: 'Chen' },
  parentId: { _id: 'parent-2', firstName: 'Max', lastName: 'Chen', email: 'max@example.com' },
  cancelAtPeriodEnd: true,
});

const CHARGE_PREVIEW: ChargePreview = {
  outcome: 'previewable',
  due: true,
  nextBillingDate: '2026-10-26T00:00:00.000Z',
  willFinalizeCancellation: false,
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  paymentMethod: { cardBrand: 'visa', cardLast4: '4242' },
  inDunning: false,
  amount: 150,
  breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0 },
  options: {
    fullMonth: {
      amount: 150,
      breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0 },
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    },
    prorated: null,
  },
  monthAlreadyPaid: null,
};

/** The list endpoint answers by the `status` filter the page sends, as the backend does. */
function listRule(requestedStatuses: (string | null)[], rows: () => AdminSubscriptionRow[]): MockRule {
  return {
    method: 'GET',
    path: '/subscriptions',
    handler: (route, { url }) => {
      const status = url.searchParams.get('status');
      requestedStatuses.push(status);
      const all = rows();
      const filtered =
        status === 'pending_cancel'
          ? all.filter((row) => row.status === 'active' && row.cancelAtPeriodEnd)
          : status === 'active'
            ? all.filter((row) => row.status === 'active' && !row.cancelAtPeriodEnd)
            : status === 'cancelled'
              ? all.filter((row) => row.status === 'cancelled')
              : all;
      return json<AdminSubscriptionListResponse>(route, 200, {
        subscriptions: filtered,
        total: filtered.length,
        totalPages: 1,
        currentPage: 1,
      });
    },
  };
}

const CATALOG: MockRule[] = [
  { method: 'GET', path: '/group-classes', handler: (route) => json<GroupClassesResponse>(route, 200, { groupClasses: [CLASS_A, CLASS_B, CLASS_C] }) },
  {
    method: 'GET',
    path: '/group-class-schedules',
    handler: (route) => json<GroupClassSchedulesResponse>(route, 200, { schedules: [SCHEDULE_A, SCHEDULE_B, SCHEDULE_C] }),
  },
];

test.describe('admin subscriptions', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test('the status filter asks the server for pending cancellations and shows only those', async ({ page }) => {
    const statuses: (string | null)[] = [];
    await loginAs(page, 'admin', [listRule(statuses, () => [adminRow(), PENDING_CANCEL_ROW]), ...CATALOG]);
    await page.goto('/admin/subscriptions');
    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await expect(page.getByText('Lee Chen')).toBeVisible();
    await expectNoBlockingA11yViolations(page);

    await page.getByLabel('Status').selectOption('pending_cancel');

    await expect(page.getByText('Sam Rivera')).toHaveCount(0);
    await expect(page.getByText('Lee Chen')).toBeVisible();
    expect(statuses).toContain('pending_cancel');
  });

  test('Change Schedule offers only same-level schedules and sends the chosen schedule id', async ({ page }) => {
    let payload: unknown = null;
    const overrides: MockRule[] = [
      listRule([], () => [adminRow()]),
      ...CATALOG,
      {
        method: 'PATCH',
        path: '/subscriptions/:id/schedule',
        handler: (route, { params }) => {
          expect(params.id).toBe('sub-1');
          payload = route.request().postDataJSON();
          return json<AdminSubscriptionResponse>(route, 200, { subscription: adminRow() });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);
    await page.goto('/admin/subscriptions');

    await page.getByRole('button', { name: /change schedule/i }).click();
    const dialog = page.getByRole('dialog', { name: /change schedule/i });
    const select = dialog.getByLabel(/new schedule/i);
    await expect(select.getByRole('option', { name: /Beginner Foil B/ })).toHaveCount(1);
    await expect(select.getByRole('option', { name: /Advanced Epee/ })).toHaveCount(0);
    await expect(select.getByRole('option', { name: /Beginner Foil A/ })).toHaveCount(0);

    await select.selectOption('sched-b');
    await dialog.getByRole('button', { name: /continue/i }).click();
    await expect(dialog.getByText(/monthly fee unchanged/i)).toBeVisible();
    await dialog.getByRole('button', { name: /confirm change/i }).click();

    await expect(dialog).toBeHidden();
    expect(payload).toEqual({ newScheduleId: 'sched-b' });
  });

  test('cancelling and reactivating each go through a confirm dialog to the right subscription', async ({ page }) => {
    const calls: string[] = [];
    const overrides: MockRule[] = [
      listRule([], () => [adminRow(), PENDING_CANCEL_ROW]),
      ...CATALOG,
      {
        method: 'POST',
        path: '/subscriptions/:id/cancel',
        handler: (route, { params }) => {
          calls.push(`cancel ${params.id}`);
          return json<AdminSubscriptionResponse>(route, 200, { subscription: adminRow({ cancelAtPeriodEnd: true }) });
        },
      },
      {
        method: 'POST',
        path: '/subscriptions/:id/reactivate',
        handler: (route, { params }) => {
          calls.push(`reactivate ${params.id}`);
          return json<AdminSubscriptionResponse>(route, 200, { subscription: PENDING_CANCEL_ROW });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);
    await page.goto('/admin/subscriptions');

    await page.getByRole('row').filter({ hasText: 'Sam Rivera' }).getByRole('button', { name: /^cancel$/i }).click();
    const cancelDialog = page.getByRole('dialog', { name: /cancel subscription/i });
    await expect(cancelDialog.getByText(/nothing is refunded/i)).toBeVisible();
    await cancelDialog.getByRole('button', { name: /^cancel subscription$/i }).click();
    await expect(cancelDialog).toBeHidden();

    await page.getByRole('row').filter({ hasText: 'Lee Chen' }).getByRole('button', { name: /reactivate/i }).click();
    const reactivateDialog = page.getByRole('dialog', { name: /reactivate subscription/i });
    await expect(reactivateDialog.getByText(/nothing is charged now/i)).toBeVisible();
    await reactivateDialog.getByRole('button', { name: /remove cancellation/i }).click();
    await expect(reactivateDialog).toBeHidden();

    expect(calls).toEqual(['cancel sub-1', 'reactivate sub-2']);
  });

  test('a superadmin charges from the preview the server computed, sending the chosen period', async ({ page }) => {
    let chargeBody: unknown = null;
    const overrides: MockRule[] = [
      listRule([], () => [adminRow()]),
      ...CATALOG,
      {
        method: 'GET',
        path: '/subscriptions/:id/charge-preview',
        handler: (route) => json<ChargePreview>(route, 200, CHARGE_PREVIEW),
      },
      {
        method: 'POST',
        path: '/subscriptions/:id/charge',
        handler: (route, { params }) => {
          expect(params.id).toBe('sub-1');
          chargeBody = route.request().postDataJSON();
          return json<ChargeResult>(route, 200, { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 150, siblingDiscountApplied: false });
        },
      },
    ];
    await loginAs(page, 'superadmin', overrides);
    await page.goto('/admin/subscriptions');

    await page.getByRole('button', { name: /^charge$/i }).click();
    const dialog = page.getByRole('dialog', { name: /charge subscription/i });
    await expect(dialog.getByText('Monthly fee: $150.00')).toBeVisible();
    await expect(dialog.getByText('Total: $150.00')).toBeVisible();
    await expect(dialog.getByText('Visa •••• 4242')).toBeVisible();

    await dialog.getByRole('button', { name: /confirm charge/i }).click();

    await expect(dialog.getByText(/charged \$150\.00/i)).toBeVisible();
    expect(chargeBody).toEqual({ period: 'full' });
  });

  test('a plain admin is never offered Charge', async ({ page }) => {
    await loginAs(page, 'admin', [listRule([], () => [adminRow()]), ...CATALOG]);
    await page.goto('/admin/subscriptions');

    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await expect(page.getByRole('button', { name: /^charge$/i })).toHaveCount(0);
  });
});
