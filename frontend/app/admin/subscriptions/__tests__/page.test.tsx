import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminSubscriptionsPage from '../page';

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
    ...overrides,
  };
}

let rows: unknown[] = [makeRow()];
let changeSchedulePayload: unknown = null;
let cancelledId: string | null = null;
let reactivatedId: string | null = null;
let scheduleRouteStatus = 200;
let scheduleRouteMessage = 'Failed';

const server = setupServer(
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
});
afterAll(() => server.close());

describe('AdminSubscriptionsPage', () => {
  it('renders a row from the API with student/parent/class/schedule/status', async () => {
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Pat Rivera')).toBeInTheDocument();
    expect(within(table).getByText('Beginner Foil A')).toBeInTheDocument();
    expect(within(table).getByText('$150.00')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
  });

  it('shows the one-time registration fee as a note under Last Charge when the subscription has one', async () => {
    rows = [makeRow({ registrationFeeCharged: 25 })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.getByText('+ $25.00 registration fee')).toBeInTheDocument();
  });

  it('shows a "Prorated first month" chip when firstChargeProrated is true, and omits it otherwise', async () => {
    rows = [makeRow({ firstChargeProrated: true })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.getByText('Prorated first month')).toBeInTheDocument();
  });

  it('omits the prorated chip when firstChargeProrated is false', async () => {
    rows = [makeRow({ firstChargeProrated: false })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.queryByText('Prorated first month')).not.toBeInTheDocument();
  });

  it('omits the registration-fee note entirely when none was charged', async () => {
    rows = [makeRow({ registrationFeeCharged: 0 })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.queryByText(/registration fee/i)).not.toBeInTheDocument();
  });

  it('shows a gold "Cancels <date>" chip and a Reactivate action for a pending-cancel subscription', async () => {
    rows = [makeRow({ cancelAtPeriodEnd: true })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.getByText(/cancels/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it('shows a "Premium — any session" chip and hides Change Schedule for an active premium subscription', async () => {
    rows = [makeRow({ isPremium: true })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(screen.getByText(/premium — any session/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change schedule/i })).not.toBeInTheDocument();
    // Cancel is still offered — premium only blocks Change Schedule.
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('shows a muted "Cancelled" chip and no actions for a cancelled subscription', async () => {
    rows = [makeRow({ status: 'cancelled', cancelAtPeriodEnd: false })];
    render(<AdminSubscriptionsPage />);

    await screen.findByText('Sam Rivera');
    expect(within(screen.getByRole('table')).getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reactivate/i })).not.toBeInTheDocument();
  });

  it('Change Schedule dialog filters the new-schedule select to the same level, excluding the current schedule', async () => {
    const user = userEvent.setup();
    render(<AdminSubscriptionsPage />);

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
    render(<AdminSubscriptionsPage />);

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
    render(<AdminSubscriptionsPage />);

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
    render(<AdminSubscriptionsPage />);

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
    render(<AdminSubscriptionsPage />);

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
});
