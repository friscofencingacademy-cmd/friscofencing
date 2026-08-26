import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SubscriptionsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

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
};

const PRIVATE_ENTRY = {
  enrollment: {
    _id: 'penroll-1',
    studentId: { _id: 'student-3', firstName: 'Priv', lastName: 'Lessons' },
    parentId: { _id: 'parent-1', firstName: 'Par', lastName: 'Ent', email: 'parent@example.com' },
    coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
    coachContractId: 'contract-1',
    agreedHourlyRate: 65,
    status: 'active',
    endDate: null,
  },
  slot: {
    _id: 'pschedule-1',
    coachId: 'coach-1',
    dayOfWeek: 2,
    startTime: '16:00',
    durationMinutes: 60,
    studentId: 'student-1',
    enrollmentId: 'penroll-1',
    isActive: true,
  },
  charges: [
    {
      _id: 'charge-1',
      sessionId: 'session-1',
      enrollmentId: 'penroll-1',
      parentId: 'parent-1',
      studentId: 'student-1',
      amount: 65,
      status: 'completed',
      stripePaymentIntentId: 'pi_1',
      attempt: 1,
      failureMessage: null,
      paidAt: '2026-08-26T16:00:00.000Z',
      createdAt: '2026-08-26T16:00:00.000Z',
    },
  ],
};

let cancelledSubscriptionId: string | null = null;
let cancelledPrivateEnrollmentId: string | null = null;

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
  http.post('*/private-class-enrollments/:id/cancel', ({ params }) => {
    cancelledPrivateEnrollmentId = params.id as string;
    return HttpResponse.json({ enrollment: { ...PRIVATE_ENTRY.enrollment, status: 'cancelled' } });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  cancelledSubscriptionId = null;
  cancelledPrivateEnrollmentId = null;
});
afterAll(() => server.close());

function renderSubscriptionsPage() {
  return render(
    <AuthProvider>
      <SubscriptionsPage />
    </AuthProvider>
  );
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
    expect(screen.getAllByText('2026-02-01')).toHaveLength(2);
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    // Neither fixture sets lastSiblingDiscountApplied -> no chip.
    expect(screen.queryByText('10% sibling')).not.toBeInTheDocument();

    // The cancelled row: no Cancel button, no "Cancels at end..." text —
    // hidden entirely once status is 'cancelled'.
    expect(screen.getByText('Other Kid')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/cancels at end of current period/i)).not.toBeInTheDocument();

    // Exactly one Cancel button (only the active, non-cancelling row).
    expect(screen.getAllByRole('button', { name: /^cancel$/i })).toHaveLength(1);
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

    const cancelButton = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(cancelledSubscriptionId).toBe(ACTIVE_SUBSCRIPTION._id);
    });

    expect(await screen.findByText(/cancels at end of current period/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
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
    const cancelButton = await screen.findByRole('button', { name: /^cancel$/i });

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

    const cancelButton = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to cancel subscription');
    });

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
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
          subscriptions: [{ ...ACTIVE_SUBSCRIPTION, lastChargeAmount: 135, lastSiblingDiscountApplied: true }],
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

  describe('Private Lessons section', () => {
    it('renders a row per private enrollment with coach, slot, rate, and recent charges', async () => {
      renderSubscriptionsPage();

      expect(await screen.findByText('Dana Cole')).toBeInTheDocument();
      expect(screen.getByText('Tuesday 4:00 PM')).toBeInTheDocument();
      expect(screen.getByText('$65.00/hr')).toBeInTheDocument();
      expect(screen.getByText(/\$65\.00 \(Paid\)/)).toBeInTheDocument();
    });

    it('shows the confirm-copy dialog and cancels on confirm', async () => {
      renderSubscriptionsPage();
      await screen.findByText('Dana Cole');

      const privateRow = screen.getByText('Dana Cole').closest('tr');
      expect(privateRow).not.toBeNull();

      fireEvent.click(within(privateRow as HTMLElement).getByRole('button', { name: /^cancel lessons$/i }));

      expect(
        await screen.findByText(/all upcoming sessions will be removed/i)
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^confirm cancellation$/i }));

      await waitFor(() => expect(cancelledPrivateEnrollmentId).toBe('penroll-1'));
    });

    it('shows a message when the parent has no private lessons yet', async () => {
      server.use(http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })));

      renderSubscriptionsPage();

      expect(await screen.findByText(/you don't have any private lessons yet/i)).toBeInTheDocument();
    });
  });
});
