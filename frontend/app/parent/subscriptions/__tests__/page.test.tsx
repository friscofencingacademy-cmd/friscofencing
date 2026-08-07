import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

let cancelledSubscriptionId: string | null = null;

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
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  cancelledSubscriptionId = null;
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
    expect(screen.getByText('Wednesday 16:00-17:00')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getAllByText('2026-02-01')).toHaveLength(2);
    expect(screen.getByText('$150.00')).toBeInTheDocument();

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
    expect(screen.getByText('Wednesday 16:00-17:00')).toBeInTheDocument();
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
});
