import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SchedulesPage from '../page';

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

beforeAll(() => server.listen());
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

    fireEvent.click(screen.getByRole('button', { name: /add schedule/i }));

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Coach'), { target: { value: 'coach-1' } });
    fireEvent.change(screen.getByLabelText('Day of Week'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Start Time'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('End Time'), { target: { value: '19:00' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

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
