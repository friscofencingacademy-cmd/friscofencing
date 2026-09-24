import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

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
    discountPercent: 10,
    sessionsUsed: 3,
    status: 'active',
    createdAt: '2026-10-05T14:00:00.000Z',
  },
  // Server values, rendered verbatim — not 10 - 3.
  remaining: 7,
  payment: { _id: 'reg-1', amount: 292.5, quantity: 10, unitPrice: 32.5, discountPercent: 10, paidAt: '2026-10-05T14:00:00.000Z' },
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

let cancelledId: string | null = null;
let publishPayload: unknown = null;

const server = setupServer(
  http.get('*/private-class-enrollments', () => HttpResponse.json({ enrollments: [PURCHASE] })),
  http.get('*/private-class-sessions', () => HttpResponse.json({ sessions: [BOOKING, PAST_BOOKING] })),
  http.get('*/private-class-schedules', () => HttpResponse.json({ schedules: [RULE] })),
  http.get('*/users', () => HttpResponse.json({ users: [COACH] })),
  http.post('*/private-class-sessions/:id/cancel', ({ params }) => {
    cancelledId = String(params.id);
    return HttpResponse.json({ session: { ...BOOKING, status: 'cancelled', attendance: 'cancelled' }, remaining: 8 });
  }),
  http.post('*/private-class-schedules', async ({ request }) => {
    publishPayload = await request.json();
    return HttpResponse.json({ schedules: [RULE] }, { status: 201 });
  }),
  http.delete('*/private-class-schedules/:id', () =>
    HttpResponse.json({ message: 'This slot has upcoming bookings — cancel them before removing it' }, { status: 409 })
  )
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  replaceMock.mockReset();
  mockSearchParams = new URLSearchParams();
  cancelledId = null;
  publishPayload = null;
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
    expect(within(row).getByText('$292.50')).toBeInTheDocument();
    expect(within(row).getByText('10% pack discount')).toBeInTheDocument();
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

  it('Availability: publishes on a coach\'s behalf (the coach picker is required) and shows a removal 409 verbatim', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'availability' });
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    expect(await screen.findByText('Tuesdays · 4:30 PM · 30 min')).toBeInTheDocument();

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

    await user.click(screen.getByRole('button', { name: 'Remove Tuesdays · 4:30 PM · 30 min' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: 'Cannot Remove' })).toBeInTheDocument();
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
