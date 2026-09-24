import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SubscriptionsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import type { PrivatePurchaseEntry } from '../../../../lib/types';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Par',
  lastName: 'Ent',
  email: 'parent@example.com',
};

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };
const SCHEDULE = { _id: 'sched-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' };

const ACTIVE_SUBSCRIPTION = {
  _id: 'sub-1',
  studentId: STUDENT,
  scheduleId: SCHEDULE,
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  nextBillingDate: '2026-02-01T00:00:00.000Z',
  lastChargeAmount: 150,
  lastPayment: { amount: 150, paidAt: '2026-01-01T12:00:00.000Z', chargeMethod: 'card' },
};

const CANCELLED_SUBSCRIPTION = {
  _id: 'sub-2',
  studentId: { _id: 'student-2', firstName: 'Other', lastName: 'Kid' },
  scheduleId: { _id: 'sched-2', dayOfWeek: 4, startTime: '18:00', endTime: '19:00' },
  status: 'cancelled',
  cancelAtPeriodEnd: true,
  currentPeriodEnd: '2026-01-01T00:00:00.000Z',
  nextBillingDate: '2026-01-01T00:00:00.000Z',
  lastChargeAmount: null,
  lastPayment: null,
};

// A 10-session purchase with two bookings (ADR 011). remaining and
// canCancel are server values — rendered, never derived.
const PRIVATE_ENTRY: PrivatePurchaseEntry = {
  enrollment: {
    _id: 'enroll-1',
    studentId: { _id: 'student-3', firstName: 'Priv', lastName: 'Lessons' },
    parentId: { _id: 'parent-1', firstName: 'Par', lastName: 'Ent', email: 'parent@example.com' },
    coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
    agreedHourlyRate: 65,
    sessionDurationMinutes: 30,
    quantity: 10,
    discountPercent: 10,
    sessionsUsed: 2,
    status: 'active',
    createdAt: '2026-10-05T14:00:00.000Z',
  },
  remaining: 8,
  payment: { _id: 'reg-1', amount: 292.5, quantity: 10, unitPrice: 32.5, discountPercent: 10, paidAt: '2026-10-05T14:00:00.000Z' },
  sessions: [
    {
      _id: 'booking-past',
      scheduleId: 'rule-1',
      enrollmentId: 'enroll-1',
      coachId: 'coach-1',
      studentId: 'student-3',
      parentId: 'parent-1',
      startDate: '2026-10-06T21:30:00.000Z',
      endDate: '2026-10-06T22:00:00.000Z',
      status: 'confirmed',
      attendance: 'attended',
      canCancel: false,
    },
    {
      _id: 'booking-next',
      scheduleId: 'rule-1',
      enrollmentId: 'enroll-1',
      coachId: 'coach-1',
      studentId: 'student-3',
      parentId: 'parent-1',
      startDate: '2026-10-20T21:30:00.000Z',
      endDate: '2026-10-20T22:00:00.000Z',
      status: 'confirmed',
      attendance: 'scheduled',
      canCancel: true,
    },
  ],
};

let cancelledSubscriptionId: string | null = null;
let cancelledBookingId: string | null = null;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/registrations/mine', () =>
    HttpResponse.json({ subscriptions: [ACTIVE_SUBSCRIPTION, CANCELLED_SUBSCRIPTION] })
  ),
  http.post('*/subscriptions/:id/cancel', ({ params }) => {
    cancelledSubscriptionId = params.id as string;
    return HttpResponse.json({
      subscription: { ...ACTIVE_SUBSCRIPTION, cancelAtPeriodEnd: true },
    });
  }),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [PRIVATE_ENTRY] })),
  http.post('*/private-class-sessions/:id/cancel', ({ params }) => {
    cancelledBookingId = params.id as string;
    return HttpResponse.json({
      session: { ...PRIVATE_ENTRY.sessions[1], status: 'cancelled', attendance: 'cancelled' },
      remaining: 9,
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  cancelledSubscriptionId = null;
  cancelledBookingId = null;
});
afterAll(() => server.close());

function renderSubscriptionsPage() {
  return render(
    <AuthProvider>
      <SubscriptionsPage />
    </AuthProvider>
  );
}

// The group-registrations table (the page also lists private-lesson
// bookings, each with its own Cancel button).
async function findGroupTable(): Promise<HTMLElement> {
  return (await screen.findByText('Kid One')).closest('table') as HTMLElement;
}

describe('SubscriptionsPage', () => {
  it("renders the parent's registrations with student, schedule, status, dates, and last charge", async () => {
    renderSubscriptionsPage();

    expect(await screen.findByText('Kid One')).toBeInTheDocument();
    expect(screen.getByText('Wednesday 4:00 PM-5:00 PM')).toBeInTheDocument();
    // Scoped to the group-registration row itself — the new Private Lessons
    // section below can also render an "active" status cell for its own,
    // unrelated row.
    const groupRow = screen.getByText('Kid One').closest('tr') as HTMLElement;
    expect(within(groupRow).getByText('active')).toBeInTheDocument();
    // currentPeriodEnd/nextBillingDate render via formatDateOnly (docs/plans/
    // utc-date-standard-plan.md) — a pretty, UTC-anchored label, not the
    // raw ISO-slice this page used to show.
    expect(screen.getAllByText('Feb 1, 2026')).toHaveLength(2);
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    // Neither fixture sets lastSiblingDiscountApplied -> no chip.
    expect(screen.queryByText('10% sibling')).not.toBeInTheDocument();

    // The cancelled row: no Cancel button, no "Cancels at end..." text —
    // hidden entirely once status is 'cancelled'.
    expect(screen.getByText('Other Kid')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/cancels at end of current period/i)).not.toBeInTheDocument();

    // Exactly one Cancel button in the group table (only the active,
    // non-cancelling row).
    expect(within(await findGroupTable()).getAllByRole('button', { name: /^cancel$/i })).toHaveLength(1);
  });

  it('cancelling an active subscription posts to /subscriptions/:id/cancel and swaps the button for "Cancels at end of current period"', async () => {
    renderSubscriptionsPage();

    await screen.findByText('Kid One');

    // The page refetches the full list after a successful cancel (rather than
    // merging the bare cancel response into state) — swap in a handler that
    // reflects the cancellation so the refetch shows the updated row.
    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [
            { ...ACTIVE_SUBSCRIPTION, cancelAtPeriodEnd: true },
            CANCELLED_SUBSCRIPTION,
          ],
        })
      )
    );

    fireEvent.click(within(await findGroupTable()).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(cancelledSubscriptionId).toBe(ACTIVE_SUBSCRIPTION._id);
    });

    expect(await screen.findByText(/cancels at end of current period/i)).toBeInTheDocument();
    expect(within(await findGroupTable()).queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it('shows the correct student name and schedule (not "undefined") after a successful cancel — regression for the unpopulated-merge bug', async () => {
    // The real backend's POST /subscriptions/:id/cancel returns the bare,
    // unpopulated Subscription document — studentId/scheduleId as raw
    // ObjectId strings, not the populated { firstName, lastName } / { dayOfWeek,
    // startTime, endTime } objects the table renders. The old code spread that
    // bare response into local state, which overwrote the populated fields and
    // rendered "undefined undefined-undefined" until the next full reload.
    // The fix refetches the full populated list instead of merging.
    server.use(
      http.post('*/subscriptions/:id/cancel', ({ params }) => {
        cancelledSubscriptionId = params.id as string;
        return HttpResponse.json({
          subscription: {
            _id: ACTIVE_SUBSCRIPTION._id,
            studentId: STUDENT._id,
            scheduleId: SCHEDULE._id,
            status: 'active',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: ACTIVE_SUBSCRIPTION.currentPeriodEnd,
            nextBillingDate: ACTIVE_SUBSCRIPTION.nextBillingDate,
            lastChargeAmount: ACTIVE_SUBSCRIPTION.lastChargeAmount,
          },
        });
      })
    );

    renderSubscriptionsPage();

    // Wait for the initial, correctly-populated render before triggering the
    // cancel — only then swap the GET handler to reflect the post-cancel
    // state, so the refetch (not the initial load) picks it up.
    const cancelButton = within(await findGroupTable()).getByRole('button', { name: /^cancel$/i });

    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [
            { ...ACTIVE_SUBSCRIPTION, cancelAtPeriodEnd: true },
            CANCELLED_SUBSCRIPTION,
          ],
        })
      )
    );

    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.getByText(/cancels at end of current period/i)).toBeInTheDocument();
    });

    // The row must still show the real, populated display values — never the
    // "undefined undefined-undefined" the bare merge produced.
    expect(screen.getByText('Kid One')).toBeInTheDocument();
    expect(screen.getByText('Wednesday 4:00 PM-5:00 PM')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('shows an inline error and keeps the Cancel button when the cancel request fails, without crashing', async () => {
    server.use(
      http.post('*/subscriptions/:id/cancel', () =>
        HttpResponse.json({ message: 'Failed to cancel subscription' }, { status: 500 })
      )
    );

    renderSubscriptionsPage();

    fireEvent.click(within(await findGroupTable()).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to cancel subscription');
    });

    expect(within(await findGroupTable()).getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('shows a message when the parent has no registrations yet', async () => {
    server.use(
      http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] }))
    );

    renderSubscriptionsPage();

    expect(
      await screen.findByText(/you don't have any registrations yet/i)
    ).toBeInTheDocument();
  });

  it('shows a "10% sibling" chip next to the charge amount when lastSiblingDiscountApplied is true', async () => {
    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [
            {
              ...ACTIVE_SUBSCRIPTION,
              lastChargeAmount: 135,
              lastSiblingDiscountApplied: true,
              lastPayment: { amount: 135, paidAt: '2026-01-01T12:00:00.000Z', chargeMethod: 'card' },
            },
          ],
        })
      )
    );

    renderSubscriptionsPage();

    expect(await screen.findByText('$135.00')).toBeInTheDocument();
    expect(screen.getByText('10% sibling')).toBeInTheDocument();
  });

  it('shows a "Prorated first month" chip when firstChargeProrated is true, and omits it otherwise', async () => {
    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [{ ...ACTIVE_SUBSCRIPTION, firstChargeProrated: true }],
        })
      )
    );

    renderSubscriptionsPage();

    expect(await screen.findByText('Prorated first month')).toBeInTheDocument();
  });

  it('shows the LIVE current sibling discount (and reason) separately from the historical Last Charge — even when they disagree', async () => {
    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [
            {
              // Historically charged full price with no discount (this
              // subscription was created before the sibling existed) — but
              // the LIVE currentCharge now says the sibling has the
              // lower-priced plan instead. The two must render as distinct,
              // clearly-labeled facts, not be collapsed into one.
              ...ACTIVE_SUBSCRIPTION,
              lastChargeAmount: 150,
              lastSiblingDiscountApplied: false,
              currentCharge: {
                amount: 150,
                siblingDiscountApplied: false,
                siblingDiscountAmount: 0,
                reason: 'Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.',
              },
            },
          ],
        })
      )
    );

    renderSubscriptionsPage();

    expect(await screen.findByText('$150.00')).toBeInTheDocument();
    expect(screen.getByText('Full price')).toBeInTheDocument();
    expect(
      screen.getByText('Your other child has the lower-priced plan, so the sibling discount applies to their plan instead.')
    ).toBeInTheDocument();
  });

  it('shows a live "10% sibling" current-discount chip with its reason when currentCharge says the discount applies', async () => {
    server.use(
      http.get('*/registrations/mine', () =>
        HttpResponse.json({
          subscriptions: [
            {
              ...ACTIVE_SUBSCRIPTION,
              currentCharge: {
                amount: 135,
                siblingDiscountApplied: true,
                siblingDiscountAmount: 15,
                reason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
              },
            },
          ],
        })
      )
    );

    renderSubscriptionsPage();

    expect(await screen.findByText('10% sibling — $135.00/mo')).toBeInTheDocument();
    expect(
      screen.getByText('This is the lower-priced plan among your active children, so the 10% sibling discount applies here.')
    ).toBeInTheDocument();
  });

  it('shows a dash for currentCharge when the subscription is cancelled (no live discount to compute)', async () => {
    renderSubscriptionsPage();

    // CANCELLED_SUBSCRIPTION never sets currentCharge — its row must show a
    // plain dash, not "Full price" or a stale chip. (lastChargeAmount is
    // also null on this fixture, so its Last Charge cell renders its own
    // '—' too — two dashes total in the row, not a display bug.)
    const cancelledRow = (await screen.findByText('Other Kid')).closest('tr') as HTMLElement;
    expect(within(cancelledRow).getAllByText('—')).toHaveLength(2);
  });

  describe('Private Lessons section (per-session bookings, ADR 011)', () => {
    it('shows each purchase with sessions left, the amount paid, and its bookings with status', async () => {
      renderSubscriptionsPage();

      expect(await screen.findByRole('heading', { name: 'Priv Lessons with Dana Cole' })).toBeInTheDocument();
      expect(screen.getByText('8 of 10 sessions left · 30 min each · Paid $292.50')).toBeInTheDocument();

      const past = screen.getByText('Tue, Oct 6, 2026, 4:30 PM').closest('tr') as HTMLElement;
      const next = screen.getByText('Tue, Oct 20, 2026, 4:30 PM').closest('tr') as HTMLElement;
      expect(within(past).getByText('Attended')).toBeInTheDocument();
      expect(within(next).getByText('Booked')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /book a lesson/i })).toHaveAttribute('href', '/private-classes');
    });

    it('offers Cancel only where the server says canCancel, and cancelling posts to that booking', async () => {
      renderSubscriptionsPage();

      const past = (await screen.findByText('Tue, Oct 6, 2026, 4:30 PM')).closest('tr') as HTMLElement;
      const next = screen.getByText('Tue, Oct 20, 2026, 4:30 PM').closest('tr') as HTMLElement;
      expect(within(past).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

      fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/the session goes back to your balance/i)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel Lesson' }));

      await waitFor(() => expect(cancelledBookingId).toBe('booking-next'));
    });

    it('shows the server refusal inside the dialog without crashing', async () => {
      server.use(
        http.post('*/private-class-sessions/:id/cancel', () =>
          HttpResponse.json(
            { message: 'Lessons can be cancelled online up to 24 hours before they start — please contact the academy' },
            { status: 409 }
          )
        )
      );
      renderSubscriptionsPage();

      const next = (await screen.findByText('Tue, Oct 20, 2026, 4:30 PM')).closest('tr') as HTMLElement;
      fireEvent.click(within(next).getByRole('button', { name: 'Cancel' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel Lesson' }));

      expect(await screen.findByText(/up to 24 hours before they start/i)).toBeInTheDocument();
    });

    // orphaned-coach-reference-fix-plan D2/D3/§8a — a purchase whose student
    // or coach was deleted without a delete-guard must degrade, not crash.
    it('renders fallback labels when the purchase student/coach were deleted', async () => {
      server.use(
        http.get('*/private-class-enrollments/mine', () =>
          HttpResponse.json({
            enrollments: [{ ...PRIVATE_ENTRY, enrollment: { ...PRIVATE_ENTRY.enrollment, studentId: null, coachId: null } }],
          })
        )
      );

      renderSubscriptionsPage();

      expect(
        await screen.findByRole('heading', { name: 'Student no longer available with Coach no longer available' })
      ).toBeInTheDocument();
    });

    it('shows a message when the parent has no private lessons yet', async () => {
      server.use(http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })));

      renderSubscriptionsPage();

      expect(await screen.findByText(/you don't have any private lessons yet/i)).toBeInTheDocument();
    });

    it('renders LoadError for a failed private-lessons load while the group table still renders', async () => {
      server.use(
        http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
      );

      renderSubscriptionsPage();

      expect(await screen.findByText('Kid One')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });
});
