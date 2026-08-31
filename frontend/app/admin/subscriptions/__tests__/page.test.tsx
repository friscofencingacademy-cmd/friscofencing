import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminSubscriptionsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

// Defaults to superadmin so the Charge button/dialog tests below don't need
// their own per-test auth wiring — tests that specifically need a non-
// superadmin viewer override this before rendering (same pattern
// admin/audits/__tests__/page.test.tsx uses).
let authUser: Record<string, unknown> | null = {
  _id: 'super-1',
  role: 'superadmin',
  firstName: 'Super',
  lastName: 'Admin',
  email: 'super@example.com',
};

function renderPage() {
  return render(
    <AuthProvider>
      <AdminSubscriptionsPage />
    </AuthProvider>
  );
}

const LEVEL = { _id: 'level-1', name: 'Beginner', order: 1 };
const OTHER_LEVEL = { _id: 'level-2', name: 'Advanced', order: 2 };
const LOCATION = { _id: 'loc-1', name: 'Frisco HQ', address: '1 Main St', timezone: 'America/Chicago' };

const CLASS_A = { _id: 'class-a', name: 'Beginner Foil A', levelId: 'level-1', locationId: 'loc-1', capacity: 10 };
const CLASS_B = { _id: 'class-b', name: 'Beginner Foil B', levelId: 'level-1', locationId: 'loc-1', capacity: 10 };
const CLASS_C = { _id: 'class-c', name: 'Advanced Epee', levelId: 'level-2', locationId: 'loc-1', capacity: 10 };

const SCHEDULE_A = { _id: 'sched-a', classId: 'class-a', coachId: 'coach-a', dayOfWeek: 1, startTime: '16:00', endTime: '17:00', students: ['student-1'] };
const SCHEDULE_B = { _id: 'sched-b', classId: 'class-b', coachId: 'coach-b', dayOfWeek: 3, startTime: '17:00', endTime: '18:00', students: [] };
const SCHEDULE_C = { _id: 'sched-c', classId: 'class-c', coachId: 'coach-c', dayOfWeek: 4, startTime: '18:00', endTime: '19:00', students: [] };

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'sub-1',
    studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Rivera' },
    parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Rivera', email: 'pat@example.com' },
    scheduleId: {
      _id: 'sched-a',
      classId: { _id: 'class-a', name: 'Beginner Foil A', levelId: LEVEL, locationId: LOCATION, capacity: 10 },
      coachId: { _id: 'coach-a', firstName: 'Coach', lastName: 'A', email: 'coacha@example.com' },
      dayOfWeek: 1,
      startTime: '16:00',
      endTime: '17:00',
      students: ['student-1'],
    },
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    nextBillingDate: '2026-02-01T00:00:00.000Z',
    lastChargeAmount: 150,
    lastSiblingDiscountApplied: false,
    lastPayment: { amount: 150, paidAt: '2026-01-01T12:00:00.000Z', chargeMethod: 'card' },
    ...overrides,
  };
}

const DEFAULT_CHARGE_PREVIEW = {
  outcome: 'previewable',
  due: true,
  nextBillingDate: '2026-02-01T00:00:00.000Z',
  willFinalizeCancellation: false,
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-03-01T00:00:00.000Z',
  paymentMethod: { cardBrand: 'visa', cardLast4: '4242' },
  inDunning: false,
  amount: 150,
  breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0 },
  // docs/plans/payment-airtight-plan.md D4 — the Charge dialog's card/
  // manual x full/prorated matrix reads these, not the top-level amount/
  // breakdown above (which stay only as the dunning-branch fallback, since
  // the real backend never populates `options` for a dunning preview).
  options: {
    fullMonth: {
      amount: 150,
      breakdown: { monthlyFee: 150, siblingDiscountApplied: false, siblingDiscountAmount: 0 },
      periodStart: '2026-02-01T00:00:00.000Z',
      periodEnd: '2026-03-01T00:00:00.000Z',
    },
    prorated: {
      amount: 75,
      breakdown: {
        monthlyFee: 150,
        prorated: true,
        proratedAmount: 75,
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
      },
      periodStart: '2026-01-15T00:00:00.000Z',
      periodEnd: '2026-02-01T00:00:00.000Z',
    },
  },
  monthAlreadyPaid: null,
};

let rows: unknown[] = [makeRow()];
let changeSchedulePayload: unknown = null;
let cancelledId: string | null = null;
let reactivatedId: string | null = null;
let scheduleRouteStatus = 200;
let scheduleRouteMessage = 'Failed';
let chargePreviewResponse: Record<string, unknown> = DEFAULT_CHARGE_PREVIEW;
let chargeResponse: Record<string, unknown> = { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 150 };
let chargedId: string | null = null;
let chargePayload: unknown = null;
let recordPaymentResponse: Record<string, unknown> = { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 90 };
let recordPaymentPayload: unknown = null;
let paymentHistoryResponse: { history: unknown[] } | null = { history: [] };
let paymentHistoryRequestedParentId: string | null = null;

const server = setupServer(
  http.get('*/auth/me', () =>
    authUser ? HttpResponse.json({ user: authUser }) : HttpResponse.json({ message: 'Unauthenticated' }, { status: 401 })
  ),
  http.get('*/subscriptions', () =>
    HttpResponse.json({ subscriptions: rows, total: rows.length, totalPages: 1, currentPage: 1 })
  ),
  http.get('*/group-class-schedules', () =>
    HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B, SCHEDULE_C] })
  ),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B, CLASS_C] })),
  http.patch('*/subscriptions/:id/schedule', async ({ request }) => {
    changeSchedulePayload = await request.json();
    if (scheduleRouteStatus !== 200) {
      return HttpResponse.json({ message: scheduleRouteMessage }, { status: scheduleRouteStatus });
    }
    return HttpResponse.json({ subscription: makeRow({ scheduleId: 'sched-b' }) });
  }),
  http.post('*/subscriptions/:id/cancel', ({ params }) => {
    cancelledId = params.id as string;
    return HttpResponse.json({ subscription: makeRow({ cancelAtPeriodEnd: true }) });
  }),
  http.post('*/subscriptions/:id/reactivate', ({ params }) => {
    reactivatedId = params.id as string;
    return HttpResponse.json({ subscription: makeRow({ cancelAtPeriodEnd: false }) });
  }),
  http.get('*/subscriptions/:id/charge-preview', () => HttpResponse.json(chargePreviewResponse)),
  http.post('*/subscriptions/:id/charge', async ({ params, request }) => {
    chargedId = params.id as string;
    chargePayload = await request.json();
    return HttpResponse.json(chargeResponse);
  }),
  http.post('*/subscriptions/:id/record-payment', async ({ params, request }) => {
    chargedId = params.id as string;
    recordPaymentPayload = await request.json();
    return HttpResponse.json(recordPaymentResponse);
  }),
  http.get('*/registrations/history', ({ request }) => {
    paymentHistoryRequestedParentId = new URL(request.url).searchParams.get('parentId');
    if (paymentHistoryResponse === null) {
      return HttpResponse.json({ message: 'Failed to list payment history' }, { status: 500 });
    }
    return HttpResponse.json(paymentHistoryResponse);
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  rows = [makeRow()];
  changeSchedulePayload = null;
  cancelledId = null;
  reactivatedId = null;
  scheduleRouteStatus = 200;
  scheduleRouteMessage = 'Failed';
  chargePreviewResponse = DEFAULT_CHARGE_PREVIEW;
  chargeResponse = { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 150 };
  chargedId = null;
  chargePayload = null;
  recordPaymentResponse = { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 90 };
  recordPaymentPayload = null;
  paymentHistoryResponse = { history: [] };
  paymentHistoryRequestedParentId = null;
  authUser = {
    _id: 'super-1',
    role: 'superadmin',
    firstName: 'Super',
    lastName: 'Admin',
    email: 'super@example.com',
  };
});
afterAll(() => server.close());

describe('AdminSubscriptionsPage', () => {
  it('renders a row from the API with student/parent/class/schedule/status', async () => {
    renderPage();

    await screen.findByText('Sam Rivera');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Pat Rivera')).toBeInTheDocument();
    expect(within(table).getByText('Beginner Foil A')).toBeInTheDocument();
    expect(within(table).getByText('$150.00')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
  });

  // orphaned-coach-reference-fix-plan D2/D3 — a schedule whose coach was
  // deleted without a delete-guard blocking it must render a fallback
  // label, not crash.
  it('renders a fallback coach label when the schedule\'s coach was deleted', async () => {
    rows = [makeRow({ scheduleId: { ...makeRow().scheduleId, coachId: null } })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.getByText('Coach no longer available')).toBeInTheDocument();
  });

  // docs/plans/payment-airtight-plan.md D11 — Last Payment shows the real
  // ledger total (fee included) as ONE figure, not a base amount plus a
  // separate "+ $X registration fee" note (the pre-D11 UI, which relied on
  // lastChargeAmount being fee-free).
  it('Last Payment reflects the real ledger total, fee included, as a single figure', async () => {
    rows = [
      makeRow({
        registrationFeeCharged: 25,
        lastPayment: { amount: 175, paidAt: '2026-01-01T12:00:00.000Z', chargeMethod: 'card' },
      }),
    ];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.getByText('$175.00')).toBeInTheDocument();
    expect(screen.queryByText(/registration fee/i)).not.toBeInTheDocument();
  });

  it('shows a "Manual" chip on Last Payment when the most recent payment was recorded manually', async () => {
    rows = [
      makeRow({
        lastPayment: { amount: 150, paidAt: '2026-01-01T12:00:00.000Z', chargeMethod: 'manual' },
      }),
    ];
    renderPage();

    await screen.findByText('Sam Rivera');
    const row = screen.getByText('Sam Rivera').closest('tr') as HTMLElement;
    expect(within(row).getByText('Manual')).toBeInTheDocument();
  });

  it('shows a "Prorated first month" chip when firstChargeProrated is true, and omits it otherwise', async () => {
    rows = [makeRow({ firstChargeProrated: true })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.getByText('Prorated first month')).toBeInTheDocument();
  });

  it('omits the prorated chip when firstChargeProrated is false', async () => {
    rows = [makeRow({ firstChargeProrated: false })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.queryByText('Prorated first month')).not.toBeInTheDocument();
  });

  it('shows a "Cancels <date>" chip and a Reactivate action for a pending-cancel subscription', async () => {
    rows = [makeRow({ cancelAtPeriodEnd: true })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.getByText(/cancels/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it('shows a "Premium — any session" chip and hides Change Schedule for an active premium subscription', async () => {
    rows = [makeRow({ isPremium: true })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(screen.getByText(/premium — any session/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change schedule/i })).not.toBeInTheDocument();
    // Cancel is still offered — premium only blocks Change Schedule.
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('shows a muted "Cancelled" chip and no actions for a cancelled subscription', async () => {
    rows = [makeRow({ status: 'cancelled', cancelAtPeriodEnd: false })];
    renderPage();

    await screen.findByText('Sam Rivera');
    expect(within(screen.getByRole('table')).getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reactivate/i })).not.toBeInTheDocument();
  });

  it('Change Schedule dialog filters the new-schedule select to the same level, excluding the current schedule', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('button', { name: /change schedule/i }));

    const dialog = await screen.findByRole('dialog', { name: /change schedule/i });
    const select = within(dialog).getByLabelText(/new schedule/i);
    const options = within(select).getAllByRole('option').map((o) => o.textContent);

    expect(options.join(' ')).toContain('Beginner Foil B');
    expect(options.join(' ')).not.toContain('Advanced Epee');
    expect(options.join(' ')).not.toContain('Beginner Foil A');
  });

  it('confirm step posts the correct payload and closes on success', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('button', { name: /change schedule/i }));

    const dialog = await screen.findByRole('dialog', { name: /change schedule/i });
    const select = within(dialog).getByLabelText(/new schedule/i);
    await user.selectOptions(select, 'sched-b');
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    expect(await within(dialog).findByText(/monthly fee unchanged/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /confirm change/i }));

    await waitFor(() => expect(changeSchedulePayload).toEqual({ newScheduleId: 'sched-b' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /change schedule/i })).not.toBeInTheDocument());
  });

  it('shows the backend 409 message inline and keeps the dialog open on failure', async () => {
    scheduleRouteStatus = 409;
    scheduleRouteMessage = 'Schedule changes must stay within the same level';

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('button', { name: /change schedule/i }));

    const dialog = await screen.findByRole('dialog', { name: /change schedule/i });
    const select = within(dialog).getByLabelText(/new schedule/i);
    await user.selectOptions(select, 'sched-b');
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));
    await user.click(within(dialog).getByRole('button', { name: /confirm change/i }));

    expect(await within(dialog).findByText('Schedule changes must stay within the same level')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /change schedule/i })).toBeInTheDocument();
  });

  it('cancel flow: confirm dialog shows the copy, submits, and reloads', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    const dialog = await screen.findByRole('dialog', { name: /cancel subscription/i });
    expect(within(dialog).getByText(/nothing is refunded/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^cancel subscription$/i }));

    await waitFor(() => expect(cancelledId).toBe('sub-1'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /cancel subscription/i })).not.toBeInTheDocument());
  });

  it('reactivate flow: confirm dialog shows the copy, submits, and reloads', async () => {
    rows = [makeRow({ cancelAtPeriodEnd: true })];
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('button', { name: /reactivate/i }));

    const dialog = await screen.findByRole('dialog', { name: /reactivate subscription/i });
    expect(within(dialog).getByText(/nothing is charged now/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /remove cancellation/i }));

    await waitFor(() => expect(reactivatedId).toBe('sub-1'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /reactivate subscription/i })).not.toBeInTheDocument()
    );
  });

  // Manual Charge button (docs/plans/manual-charge-and-pdf-invoice-plan.md
  // PR 1) — superadmin-only, dialog states.
  describe('Charge button (superadmin only)', () => {
    it('is hidden entirely for a non-superadmin admin viewer', async () => {
      authUser = { _id: 'admin-1', role: 'admin', firstName: 'Regular', lastName: 'Admin', email: 'admin@example.com' };
      renderPage();

      await screen.findByText('Sam Rivera');
      expect(screen.queryByRole('button', { name: /^charge$/i })).not.toBeInTheDocument();
    });

    it('is hidden for a cancelled subscription even for a superadmin', async () => {
      rows = [makeRow({ status: 'cancelled', cancelAtPeriodEnd: false })];
      renderPage();

      await screen.findByText('Sam Rivera');
      expect(screen.queryByRole('button', { name: /^charge$/i })).not.toBeInTheDocument();
    });

    it('shows the breakdown, total, and card on file, with Confirm enabled', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      expect(await within(dialog).findByText('Monthly fee: $150.00')).toBeInTheDocument();
      expect(within(dialog).getByText('Total: $150.00')).toBeInTheDocument();
      expect(within(dialog).getByText('Visa •••• 4242')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /confirm charge/i })).toBeEnabled();
    });

    it('shows a "no card on file" warning and disables Confirm', async () => {
      chargePreviewResponse = { ...DEFAULT_CHARGE_PREVIEW, paymentMethod: null };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      expect(await within(dialog).findByText(/no card on file/i)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /confirm charge/i })).toBeDisabled();
    });

    it('shows "Not due until" and disables Confirm when the subscription is not yet due', async () => {
      chargePreviewResponse = { ...DEFAULT_CHARGE_PREVIEW, due: false, nextBillingDate: '2099-01-01T00:00:00.000Z' };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      expect(await within(dialog).findByText(/not due until/i)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /confirm charge/i })).toBeDisabled();
    });

    it('shows the dunning note and keeps Confirm enabled (retryOne never gates on due date)', async () => {
      chargePreviewResponse = {
        ...DEFAULT_CHARGE_PREVIEW,
        due: false,
        inDunning: true,
        retryCount: 1,
        attemptsRemaining: 2,
        // The real backend never computes options/monthAlreadyPaid for a
        // dunning preview (previewRenewal returns early on that branch) —
        // dropped here so this test exercises the SAME fallback-to-
        // preview.breakdown path the real dunning response takes.
        options: undefined,
        monthAlreadyPaid: undefined,
      };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      expect(await within(dialog).findByText(/retry attempt 1 of 3/i)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /confirm charge/i })).toBeEnabled();
    });

    it('pending-cancel + due: shows the finalize copy, no breakdown, and a "Finalize" button', async () => {
      chargePreviewResponse = {
        ...DEFAULT_CHARGE_PREVIEW,
        willFinalizeCancellation: true,
        amount: undefined,
        breakdown: undefined,
      };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      expect(await within(dialog).findByText(/will finalize the cancellation/i)).toBeInTheDocument();
      expect(within(dialog).queryByText(/monthly fee/i)).not.toBeInTheDocument();
      const finalizeButton = within(dialog).getByRole('button', { name: /^finalize$/i });
      expect(finalizeButton).toBeEnabled();
    });

    it('confirm posts the charge, shows the success result, and refreshes the list', async () => {
      chargeResponse = { subscriptionId: 'sub-1', outcome: 'charged', chargeAmount: 150, siblingDiscountApplied: false };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await user.click(within(dialog).getByRole('button', { name: /confirm charge/i }));

      expect(await within(dialog).findByText(/charged \$150\.00/i)).toBeInTheDocument();
      await waitFor(() => expect(chargedId).toBe('sub-1'));
    });

    it('confirm posts the charge, shows a failure result with the failure message and next retry date', async () => {
      chargeResponse = {
        subscriptionId: 'sub-1',
        outcome: 'failed_payment',
        failureMessage: 'Your card was declined.',
        nextRetryAt: '2026-02-02T00:00:00.000Z',
      };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await user.click(within(dialog).getByRole('button', { name: /confirm charge/i }));

      expect(await within(dialog).findByText(/your card was declined/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/a retry is scheduled for/i)).toBeInTheDocument();
    });

    // docs/plans/payment-airtight-plan.md D4 — the card/manual x full/
    // prorated matrix.
    it('selecting "Prorated from today" shows the prorated total and posts period: "prorated" on charge', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await within(dialog).findByText('Monthly fee: $150.00');

      await user.click(within(dialog).getByRole('radio', { name: /prorated from today/i }));
      expect(within(dialog).getByText('Total: $75.00')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: /confirm charge/i }));

      await waitFor(() => expect(chargePayload).toEqual({ period: 'prorated' }));
    });

    it('disables the "Prorated from today" radio when the option is unavailable (a broken schedule/level chain)', async () => {
      chargePreviewResponse = { ...DEFAULT_CHARGE_PREVIEW, options: { fullMonth: DEFAULT_CHARGE_PREVIEW.options.fullMonth, prorated: null } };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await within(dialog).findByText('Monthly fee: $150.00');

      expect(within(dialog).getByRole('radio', { name: /prorated from today/i })).toBeDisabled();
      expect(within(dialog).getByText(/\(unavailable\)/i)).toBeInTheDocument();
    });

    it('greys the prorated option and states the already-paid amount/date/method when monthAlreadyPaid is set', async () => {
      chargePreviewResponse = {
        ...DEFAULT_CHARGE_PREVIEW,
        monthAlreadyPaid: { amount: 75, paidAt: '2026-01-15T18:00:00.000Z', chargeMethod: 'manual' },
      };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await within(dialog).findByText('Monthly fee: $150.00');

      await user.click(within(dialog).getByRole('radio', { name: /prorated from today/i }));

      const alreadyPaidAlert = await within(dialog).findByText(/this month is already paid/i);
      expect(alreadyPaidAlert.textContent).toContain('$75.00');
      expect(alreadyPaidAlert.textContent).toContain('(manual)');
      expect(within(dialog).getByRole('button', { name: /confirm charge/i })).toBeDisabled();
    });

    it('"Record offline payment" prefills the amount from the selected period, requires a note, and posts to record-payment', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await within(dialog).findByText('Monthly fee: $150.00');

      await user.click(within(dialog).getByRole('radio', { name: /record offline payment/i }));

      const amountInput = within(dialog).getByLabelText(/amount/i) as HTMLInputElement;
      expect(amountInput.value).toBe('150.00');

      // No note yet — Record Payment stays disabled.
      expect(within(dialog).getByRole('button', { name: /record payment/i })).toBeDisabled();

      await user.type(within(dialog).getByLabelText(/note/i), 'Paid by check #1042');
      expect(within(dialog).getByRole('button', { name: /record payment/i })).toBeEnabled();

      await user.click(within(dialog).getByRole('button', { name: /record payment/i }));

      await waitFor(() =>
        expect(recordPaymentPayload).toEqual({ amount: 150, note: 'Paid by check #1042', period: 'full' })
      );
      expect(await within(dialog).findByText(/charged \$90\.00/i)).toBeInTheDocument();
    });

    it('switching period while in manual mode re-prefills the amount', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /^charge$/i }));

      const dialog = await screen.findByRole('dialog', { name: /charge subscription/i });
      await within(dialog).findByText('Monthly fee: $150.00');

      await user.click(within(dialog).getByRole('radio', { name: /record offline payment/i }));
      await user.click(within(dialog).getByRole('radio', { name: /prorated from today/i }));

      const amountInput = within(dialog).getByLabelText(/amount/i) as HTMLInputElement;
      expect(amountInput.value).toBe('75.00');
    });
  });

  // docs/plans/manual-charge-and-pdf-invoice-plan.md's 2026-08-31 addendum —
  // reuses PaymentHistoryTable + GET /registrations/history?parentId=
  // verbatim; these tests cover the admin-page wiring only (the table's own
  // rendering is covered by its own component test, the endpoint's own
  // scoping by registration.routes.test.js).
  describe('Payment History', () => {
    it('is visible to a plain (non-superadmin) admin, unlike Charge', async () => {
      authUser = { _id: 'admin-1', role: 'admin', firstName: 'Regular', lastName: 'Admin', email: 'admin@example.com' };
      renderPage();

      await screen.findByText('Sam Rivera');
      expect(screen.getByRole('button', { name: /payment history/i })).toBeInTheDocument();
    });

    it("requests the row's parent id and shows that family's history, including a Download link for a completed row", async () => {
      paymentHistoryResponse = {
        history: [
          {
            _id: 'reg-1',
            billingShape: 'subscription_cycle',
            status: 'completed',
            amount: 150,
            chargeMethod: 'card',
            manualNote: null,
            paidAt: '2026-01-01T12:00:00.000Z',
            createdAt: '2026-01-01T12:00:00.000Z',
            studentName: 'Sam Rivera',
            description: 'Group Class Registration — Beginner Foil A (Beginner)',
            periodStart: '2026-01-01T00:00:00.000Z',
            periodEnd: '2026-02-01T00:00:00.000Z',
            sessionDate: null,
            invoiceAvailable: true,
          },
        ],
      };
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /payment history/i }));

      const dialog = await screen.findByRole('dialog', { name: /payment history/i });
      await waitFor(() => expect(paymentHistoryRequestedParentId).toBe('parent-1'));
      expect(within(dialog).getByText(/pat rivera's family/i)).toBeInTheDocument();
      expect(await within(dialog).findByText('Group Class Registration — Beginner Foil A (Beginner)')).toBeInTheDocument();
      expect(within(dialog).getByText('$150.00')).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: /download/i })).toBeInTheDocument();
    });

    it('shows an inline error, not a crash, when the history request fails', async () => {
      paymentHistoryResponse = null;
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /payment history/i }));

      const dialog = await screen.findByRole('dialog', { name: /payment history/i });
      // A 500 deliberately shows the generic message, never the raw backend
      // string (getErrorMessage's own contract — only a 4xx is user-facing).
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/something went wrong/i);
    });

    it('closes via the footer Close button', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText('Sam Rivera');
      await user.click(screen.getByRole('button', { name: /payment history/i }));

      const dialog = await screen.findByRole('dialog', { name: /payment history/i });
      // Two buttons share the accessible name "Close" here: the Modal's own
      // header X (aria-label="Close") and this dialog's footer button — the
      // footer one is the later of the two in DOM order.
      const closeButtons = within(dialog).getAllByRole('button', { name: /^close$/i });
      await user.click(closeButtons[closeButtons.length - 1]);

      expect(screen.queryByRole('dialog', { name: /payment history/i })).not.toBeInTheDocument();
    });
  });
});
