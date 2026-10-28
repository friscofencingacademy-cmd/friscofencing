import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import AdminPrivateClassesPage from '../page';
import type {
  AdminPrivateAvailabilityRule,
  AdminPrivateBookingRow,
  AuthUser,
  PrivatePurchaseEntry,
} from '../../../../lib/types';

const replaceMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

const COACH: AuthUser = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const PURCHASE: PrivatePurchaseEntry = {
  enrollment: {
    _id: 'enroll-1',
    studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
    parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Parent', email: 'pat@example.com' },
    coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
    agreedHourlyRate: 65,
    sessionDurationMinutes: 30,
    quantity: 10,
    sessionsUsed: 3,
    status: 'active',
    createdAt: '2026-10-05T14:00:00.000Z',
  },
  // Server values, rendered verbatim — not 10 - 3.
  remaining: 7,
  // Server values, rendered verbatim: `savings` deliberately is NOT
  // 10 x 32.5 - 300 (= 25), so a client-side recomputation would show.
  payment: { _id: 'reg-1', amount: 300, quantity: 10, unitPrice: 32.5, savings: 31, paidAt: '2026-10-05T14:00:00.000Z' },
  sessions: [],
};

const BOOKING: AdminPrivateBookingRow = {
  _id: 'session-1',
  scheduleId: 'rule-1',
  enrollmentId: 'enroll-1',
  coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole' },
  studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
  parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Parent' },
  startDate: '2026-10-20T21:30:00.000Z',
  endDate: '2026-10-20T22:00:00.000Z',
  status: 'confirmed',
  attendance: 'scheduled',
  canCancel: true,
};

const PAST_BOOKING: AdminPrivateBookingRow = {
  ...BOOKING,
  _id: 'session-0',
  startDate: '2026-10-06T21:30:00.000Z',
  endDate: '2026-10-06T22:00:00.000Z',
  attendance: 'missed',
  canCancel: false,
};

const RULE: AdminPrivateAvailabilityRule = {
  _id: 'rule-1',
  coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
  dayOfWeek: 2,
  startTime: '16:30',
  durationMinutes: 30,
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
  isActive: true,
  bookedCount: 1,
};
// A second coach's back-to-back 15-minute slots, no bookings — one window,
// Thu 6:00–6:30 PM.
const OTHER_COACH = { _id: 'coach-2', firstName: 'Lee', lastName: 'Park', email: 'lee@example.com' };
const FREE_RULES: AdminPrivateAvailabilityRule[] = [
  { ...RULE, _id: 'rule-2', coachId: OTHER_COACH, dayOfWeek: 4, startTime: '18:00', durationMinutes: 15, bookedCount: 0 },
  { ...RULE, _id: 'rule-3', coachId: OTHER_COACH, dayOfWeek: 4, startTime: '18:15', durationMinutes: 15, bookedCount: 0 },
];

let cancelledId: string | null = null;
let publishPayload: unknown = null;
let deletedIds: string[] = [];

const server = setupServer(
  http.get('*/private-class-enrollments', () => HttpResponse.json({ enrollments: [PURCHASE] })),
  http.get('*/private-class-sessions', () => HttpResponse.json({ sessions: [BOOKING, PAST_BOOKING] })),
  http.get('*/private-class-schedules', () => HttpResponse.json({ schedules: [RULE, ...FREE_RULES] })),
  http.get('*/users', () => HttpResponse.json({ users: [COACH] })),
  http.post('*/private-class-sessions/:id/cancel', ({ params }) => {
    cancelledId = String(params.id);
    return HttpResponse.json({ session: { ...BOOKING, status: 'cancelled', attendance: 'cancelled' }, remaining: 8 });
  }),
  http.post('*/private-class-schedules', async ({ request }) => {
    publishPayload = await request.json();
    return HttpResponse.json({ schedules: [RULE] }, { status: 201 });
  }),
  http.delete('*/private-class-schedules/:id', ({ params }) => {
    deletedIds.push(String(params.id));
    return HttpResponse.json({ outcome: 'deleted' });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  replaceMock.mockReset();
  mockSearchParams = new URLSearchParams();
  cancelledId = null;
  publishPayload = null;
  deletedIds = [];
});
afterAll(() => server.close());

describe('AdminPrivateClassesPage', () => {
  it('Purchases (default tab): each purchase with the server-computed sessions left and amount paid', async () => {
    render(<AdminPrivateClassesPage />);

    const row = (await screen.findByText('Sam Kid')).closest('tr') as HTMLElement;
    expect(within(row).getByText('pat@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Dana Cole')).toBeInTheDocument();
    expect(within(row).getByText('30 min')).toBeInTheDocument();
    expect(within(row).getByText('7 of 10')).toBeInTheDocument();
    expect(within(row).getByText('$300.00')).toBeInTheDocument();
    expect(within(row).getByText('Saved $31.00')).toBeInTheDocument();
  });

  it('switches tabs through the URL', async () => {
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    await user.click(await screen.findByRole('tab', { name: 'Bookings' }));

    expect(replaceMock).toHaveBeenCalledWith('/admin/private-classes?tab=bookings');
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Bookings: status from the Visit, Cancel only where canCancel, and cancelling posts to the booking', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'bookings' });
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    const upcoming = (await screen.findByText('Tue, Oct 20, 2026, 4:30 PM')).closest('tr') as HTMLElement;
    const past = screen.getByText('Tue, Oct 6, 2026, 4:30 PM').closest('tr') as HTMLElement;
    expect(within(upcoming).getByText('Booked')).toBeInTheDocument();
    expect(within(past).getByText('Missed')).toBeInTheDocument();
    expect(within(past).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await user.click(within(upcoming).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel Booking' }));

    await waitFor(() => expect(cancelledId).toBe('session-1'));
  });

  it('Availability: one row per window, with day, window, slot length and slot count', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'availability' });
    render(<AdminPrivateClassesPage />);

    const freeRow = (await screen.findByText('6:00 PM–6:30 PM')).closest('tr') as HTMLElement;
    expect(within(freeRow).getByText('Lee Park')).toBeInTheDocument();
    expect(within(freeRow).getByText('Thursdays')).toBeInTheDocument();
    expect(within(freeRow).getByText('15 min')).toBeInTheDocument();
    expect(within(freeRow).getByText('2')).toBeInTheDocument();
    expect(within(freeRow).getByText('Oct 1, 2026 – Dec 31, 2026')).toBeInTheDocument();

    // A window with upcoming bookings: a note instead of Remove.
    const bookedRow = screen.getByText('4:30 PM–5:00 PM').closest('tr') as HTMLElement;
    expect(within(bookedRow).getByText('Dana Cole')).toBeInTheDocument();
    expect(within(bookedRow).getByText("Has bookings — can't be removed")).toBeInTheDocument();
    expect(within(bookedRow).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('Availability: removing a window deletes each of its slots', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'availability' });
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    await user.click(await screen.findByRole('button', { name: 'Remove Thursdays · 6:00 PM–6:30 PM' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Availability removed.')).toBeInTheDocument();
    expect(deletedIds).toEqual(['rule-2', 'rule-3']);
  });

  it('Availability: a window shows its slots, and an open slot is removed on its own while a booked one stays', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'availability' });
    server.use(
      http.get('*/private-class-schedules', () =>
        HttpResponse.json({ schedules: [{ ...FREE_RULES[0], bookedCount: 1 }, FREE_RULES[1]] })
      )
    );
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    // The window has a booking, so it can't go whole — and its slots are hidden until shown.
    const windowRow = (await screen.findByText('6:00 PM–6:30 PM')).closest('tr') as HTMLElement;
    expect(within(windowRow).getByText("Has bookings — can't be removed")).toBeInTheDocument();
    expect(screen.queryByText('6:00 PM–6:15 PM')).not.toBeInTheDocument();

    const toggle = within(windowRow).getByRole('button', { name: 'Show slots of Thursdays · 6:00 PM–6:30 PM' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const bookedSlot = screen.getByText('6:00 PM–6:15 PM').closest('tr') as HTMLElement;
    expect(within(bookedSlot).getByText("Booked — can't be removed")).toBeInTheDocument();
    expect(within(bookedSlot).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Thursdays · 6:15 PM–6:30 PM' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Stop offering Thursdays · 6:15 PM–6:30 PM \(1 slot\)\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Availability removed.')).toBeInTheDocument();
    expect(deletedIds).toEqual(['rule-3']);
  });

  it('Availability: publishes on a coach\'s behalf (the coach picker is required)', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'availability' });
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    expect(await screen.findByText('4:30 PM–5:00 PM')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /publish availability/i }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Coach'), 'coach-1');
    await user.type(within(dialog).getByLabelText('From'), '2026-10-01');
    await user.type(within(dialog).getByLabelText('Until'), '2026-10-31');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Mon' }));
    await user.type(within(dialog).getByLabelText('Start time'), '10:00');
    await user.type(within(dialog).getByLabelText('End time'), '11:00');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(publishPayload).toEqual({
        coachId: 'coach-1',
        daysOfWeek: [1],
        windowStart: '10:00',
        windowEnd: '11:00',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      })
    );
    expect(await screen.findByText('Published 1 slot.')).toBeInTheDocument();
  });

  it('renders LoadError with a working retry when a tab fails to load', async () => {
    server.use(http.get('*/private-class-enrollments', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    server.use(http.get('*/private-class-enrollments', () => HttpResponse.json({ enrollments: [PURCHASE] })));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Sam Kid')).toBeInTheDocument();
  });
});
