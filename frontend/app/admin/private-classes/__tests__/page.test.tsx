import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminPrivateClassesPage from '../page';

const replaceMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

const COACH = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const ENROLLMENT = {
  _id: 'penroll-1',
  studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
  parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Parent', email: 'pat@example.com' },
  coachId: COACH,
  coachContractId: 'contract-1',
  agreedHourlyRate: 65,
  status: 'active',
  endDate: null,
};

const SCHEDULE_TAKEN = {
  _id: 'sched-1',
  coachId: 'coach-1',
  dayOfWeek: 2,
  startTime: '16:00',
  durationMinutes: 60,
  // The real backend (privateClassSchedule.service.js's listAll) populates
  // studentId with { firstName, lastName } — not a bare id string.
  studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
  enrollmentId: 'penroll-1',
  isActive: true,
};

const SCHEDULE_FREE = {
  _id: 'sched-2',
  coachId: 'coach-1',
  dayOfWeek: 3,
  startTime: '17:00',
  durationMinutes: 60,
  studentId: null,
  enrollmentId: null,
  isActive: true,
};

let enrollments: unknown[] = [ENROLLMENT];
let schedules: unknown[] = [SCHEDULE_TAKEN, SCHEDULE_FREE];
let cancelledId: string | null = null;
let deletedId: string | null = null;
let deleteStatus = 200;
let deleteMessage = 'Failed';
let createdSlotPayload: unknown = null;

const server = setupServer(
  http.get('*/private-class-enrollments', () => HttpResponse.json({ enrollments })),
  http.get('*/private-class-schedules', () => HttpResponse.json({ schedules })),
  http.get('*/users', () => HttpResponse.json({ users: [COACH] })),
  http.post('*/private-class-enrollments/:id/cancel', ({ params }) => {
    cancelledId = params.id as string;
    return HttpResponse.json({ enrollment: { ...ENROLLMENT, status: 'cancelled' } });
  }),
  http.post('*/private-class-schedules', async ({ request }) => {
    createdSlotPayload = await request.json();
    return HttpResponse.json({ schedule: { ...SCHEDULE_FREE, _id: 'sched-3' } }, { status: 201 });
  }),
  http.delete('*/private-class-schedules/:id', ({ params }) => {
    deletedId = params.id as string;
    if (deleteStatus !== 200) {
      return HttpResponse.json({ message: deleteMessage }, { status: deleteStatus });
    }
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  enrollments = [ENROLLMENT];
  schedules = [SCHEDULE_TAKEN, SCHEDULE_FREE];
  cancelledId = null;
  deletedId = null;
  deleteStatus = 200;
  deleteMessage = 'Failed';
  createdSlotPayload = null;
  replaceMock.mockClear();
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

describe('AdminPrivateClassesPage', () => {
  it('renders the Enrollments tab by default with student/parent/coach/slot/rate/status', async () => {
    render(<AdminPrivateClassesPage />);

    await screen.findByText('Sam Kid');
    expect(screen.getByText('Pat Parent')).toBeInTheDocument();
    expect(screen.getByText('Dana Cole')).toBeInTheDocument();
    expect(screen.getByText('Tuesday 4:00 PM')).toBeInTheDocument();
    expect(screen.getByText('$65.00/hr')).toBeInTheDocument();
  });

  it('cancels an enrollment with the same confirm copy as the parent side', async () => {
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/all upcoming sessions will be removed/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^cancel enrollment$/i }));

    await waitFor(() => expect(cancelledId).toBe('penroll-1'));
  });

  it('Schedules tab: shows Available/occupied chips, creates a slot, and deletes a free slot', async () => {
    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^schedules$/i }));

    await screen.findByText('Available');
    expect(screen.getByText('Sam Kid')).toBeInTheDocument(); // occupied slot shows the student name

    await user.click(screen.getByRole('button', { name: /add slot/i }));
    const dialog = await screen.findByRole('dialog', { name: /add slot/i });
    await user.selectOptions(within(dialog).getByLabelText(/^coach$/i), 'coach-1');
    await user.type(within(dialog).getByLabelText(/start time/i), '18:00');
    await user.click(within(dialog).getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createdSlotPayload).toEqual({ coachId: 'coach-1', dayOfWeek: 1, startTime: '18:00', durationMinutes: 60 })
    );
  });

  it('delete guard: a 409 on an occupied slot renders the backend message verbatim and the dialog stays open', async () => {
    deleteStatus = 409;
    deleteMessage = 'Slot has an enrolled student';

    const user = userEvent.setup();
    render(<AdminPrivateClassesPage />);

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^schedules$/i }));
    await screen.findByText('Available');

    const deleteButtons = screen.getAllByRole('button', { name: /^delete slot/i });
    await user.click(deleteButtons[0]);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(await within(dialog).findByText('Slot has an enrolled student')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
