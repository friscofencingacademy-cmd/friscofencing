import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CoachPrivateLessonsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import type { CoachPrivateAvailabilityRule, CoachPrivateBookingRow } from '../../../../lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/coach/private-students',
}));

const COACH_USER = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const UNMARKED: CoachPrivateBookingRow = {
  _id: 'session-1',
  scheduleId: 'sched-1',
  enrollmentId: 'enroll-1',
  coachId: 'coach-1',
  studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
  parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Parent' },
  startDate: '2026-10-06T21:30:00.000Z',
  endDate: '2026-10-06T22:00:00.000Z',
  status: 'confirmed',
  attendance: 'scheduled',
  canCancel: false,
};

const UPCOMING: CoachPrivateBookingRow = {
  ...UNMARKED,
  _id: 'session-2',
  studentId: { _id: 'student-2', firstName: 'Robin', lastName: 'Kid' },
  startDate: '2026-10-20T21:30:00.000Z',
  endDate: '2026-10-20T22:00:00.000Z',
  canCancel: true,
};

const RULE: CoachPrivateAvailabilityRule = {
  _id: 'rule-1',
  coachId: 'coach-1',
  dayOfWeek: 2,
  startTime: '16:30',
  durationMinutes: 30,
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
  isActive: true,
  bookedCount: 3,
};

let unmarked: CoachPrivateBookingRow[] = [UNMARKED];
let attendancePayload: { id: string; body: unknown } | null = null;
let cancelledId: string | null = null;
let publishPayload: unknown = null;
let removeStatus = 200;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: COACH_USER })),
  http.get('*/private-class-sessions/mine', ({ request }) => {
    const window = new URL(request.url).searchParams.get('window');
    return HttpResponse.json({ sessions: window === 'unmarked' ? unmarked : [UPCOMING] });
  }),
  http.patch('*/private-class-sessions/:id/attendance', async ({ params, request }) => {
    attendancePayload = { id: String(params.id), body: await request.json() };
    unmarked = [];
    return HttpResponse.json({ session: { ...UNMARKED, attendance: 'attended' } });
  }),
  http.post('*/private-class-sessions/:id/cancel', ({ params }) => {
    cancelledId = String(params.id);
    return HttpResponse.json({ session: { ...UPCOMING, status: 'cancelled', attendance: 'cancelled' }, remaining: 10 });
  }),
  http.get('*/private-class-schedules/mine', () => HttpResponse.json({ schedules: [RULE] })),
  http.post('*/private-class-schedules', async ({ request }) => {
    publishPayload = await request.json();
    return HttpResponse.json({ schedules: [RULE, { ...RULE, _id: 'rule-2', startTime: '17:00' }] }, { status: 201 });
  }),
  http.delete('*/private-class-schedules/:id', () =>
    removeStatus === 200
      ? HttpResponse.json({ outcome: 'retired' })
      : HttpResponse.json({ message: 'This slot has upcoming bookings — cancel them before removing it' }, { status: 409 })
  )
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  unmarked = [UNMARKED];
  attendancePayload = null;
  cancelledId = null;
  publishPayload = null;
  removeStatus = 200;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <CoachPrivateLessonsPage />
    </AuthProvider>
  );
}

describe('CoachPrivateLessonsPage', () => {
  it('marks a started lesson attended — a Visit, no money — and it leaves the to-do list', async () => {
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText('Sam Kid')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Tue, Oct 6, 2026, 4:30 PM')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Attended' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/\$/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(attendancePayload).toEqual({ id: 'session-1', body: { status: 'attended' } }));
    expect(await screen.findByText(/no lessons need attendance/i)).toBeInTheDocument();
  });

  it('shows the server error inline in the dialog without crashing', async () => {
    server.use(
      http.patch('*/private-class-sessions/:id/attendance', () =>
        HttpResponse.json({ message: 'Only a booked lesson can be marked' }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText('Sam Kid')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Missed' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Only a booked lesson can be marked')).toBeInTheDocument();
  });

  it('cancels an upcoming booking only where the server says canCancel', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Upcoming' }));
    const row = (await screen.findByText('Robin Kid')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel Lesson' }));

    await waitFor(() => expect(cancelledId).toBe('session-2'));
  });

  it('publishes availability through the shared dialog and reports how many slots were created', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Availability' }));
    expect(await screen.findByText('Tuesdays · 4:30 PM · 30 min')).toBeInTheDocument();
    expect(screen.getByText('Oct 1, 2026 – Dec 31, 2026')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /publish availability/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Coach')).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('From'), '2026-10-01');
    await user.type(within(dialog).getByLabelText('Until'), '2026-12-31');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tue' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Thu' }));
    await user.type(within(dialog).getByLabelText('Start time'), '17:00');
    await user.type(within(dialog).getByLabelText('End time'), '20:00');
    await user.type(within(dialog).getByLabelText(/slot length/i), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(publishPayload).toEqual({
        daysOfWeek: [2, 4],
        windowStart: '17:00',
        windowEnd: '20:00',
        slotDurationMinutes: 30,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
      })
    );
    expect(await screen.findByText('Published 2 slots.')).toBeInTheDocument();
  });

  it("shows the backend's refusal verbatim when publishing overlaps, keeping the form open", async () => {
    server.use(
      http.post('*/private-class-schedules', () =>
        HttpResponse.json({ message: 'These slots overlap availability already published for this coach: Tuesday 16:30' }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Availability' }));
    await user.click(await screen.findByRole('button', { name: /publish availability/i }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('From'), '2026-10-01');
    await user.type(within(dialog).getByLabelText('Until'), '2026-12-31');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tue' }));
    await user.type(within(dialog).getByLabelText('Start time'), '16:30');
    await user.type(within(dialog).getByLabelText('End time'), '17:00');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    expect(await within(dialog).findByText(/overlap availability already published/i)).toBeInTheDocument();
  });

  it('removing a slot reports a retired slot, and a 409 turns the dialog into "Cannot Remove"', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Availability' }));

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/slot closed — its past lessons stay on record/i)).toBeInTheDocument();

    removeStatus = 409;
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: 'Cannot Remove' })).toBeInTheDocument();
    expect(screen.getByText(/has upcoming bookings/i)).toBeInTheDocument();
  });
});
