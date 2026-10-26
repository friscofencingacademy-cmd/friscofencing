import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import SchedulesPage from '../page';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

const GROUP_CLASS = { _id: 'class-1', name: 'Beginner Foil' };
const COACH = { _id: 'coach-1', firstName: 'Cathy', lastName: 'Coach' };
const EXISTING_SCHEDULE = {
  _id: 'sched-1',
  classId: 'class-1',
  coachId: 'coach-1',
  dayOfWeek: 3,
  startTime: '16:00',
  endTime: '17:00',
  students: ['s1', 's2'],
};

let createdPayload: unknown = null;

const server = setupServer(
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [EXISTING_SCHEDULE] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [GROUP_CLASS] })),
  http.get('*/users', () => HttpResponse.json({ users: [COACH] })),
  http.post('*/group-class-schedules', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { schedule: { ...EXISTING_SCHEDULE, _id: 'sched-2', dayOfWeek: 1, students: [] } },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  createdPayload = null;
});
afterAll(() => server.close());

describe('SchedulesPage', () => {
  it('renders the existing schedules with resolved class/coach names and a View Sessions link', async () => {
    render(<SchedulesPage />);

    expect(await screen.findByText('Beginner Foil')).toBeInTheDocument();
    expect(screen.getByText('Cathy Coach')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sessions/i })).toHaveAttribute(
      'href',
      '/admin/schedules/sched-1/sessions'
    );
  });

  it('shows the "can\'t be edited" footer note and no edit/delete buttons', async () => {
    render(<SchedulesPage />);
    await screen.findByText('Beginner Foil');

    expect(screen.getByText(/can't be edited once created/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('creates a new schedule via the Add Schedule dialog with the exact payload', async () => {
    render(<SchedulesPage />);
    await screen.findByText('Beginner Foil');

    await user.click(screen.getByRole('button', { name: /add schedule/i }));

    await user.selectOptions(screen.getByLabelText('Class'), 'class-1');
    await user.selectOptions(screen.getByLabelText('Coach'), 'coach-1');
    await user.selectOptions(screen.getByLabelText('Day of Week'), '1');
    await user.type(screen.getByLabelText('Start Time'), '18:00');
    await user.type(screen.getByLabelText('End Time'), '19:00');

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({
        classId: 'class-1',
        coachId: 'coach-1',
        dayOfWeek: 1,
        startTime: '18:00',
        endTime: '19:00',
      });
    });
  });
});
