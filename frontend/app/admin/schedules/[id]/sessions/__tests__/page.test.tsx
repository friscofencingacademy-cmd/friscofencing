import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SessionsPage from '../page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sched-1' }),
}));

const SESSION = { _id: 'session-1', date: '2026-09-01T00:00:00.000Z', students: [{ studentId: 's1', isPresent: false }] };

const server = setupServer(
  http.get('*/group-class-sessions/by-schedule/:scheduleId', () => HttpResponse.json({ sessions: [SESSION] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SessionsPage (admin)', () => {
  it('renders sessions for the schedule with a Mark Attendance link', async () => {
    render(<SessionsPage />);

    expect(await screen.findByText(new Date(SESSION.date).toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mark attendance/i })).toHaveAttribute(
      'href',
      '/sessions/session-1/attendance'
    );
  });

  it('shows LoadError on failure', async () => {
    server.use(
      http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );

    render(<SessionsPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
