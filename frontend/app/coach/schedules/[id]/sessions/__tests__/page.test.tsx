import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CoachSessionsPage from '../page';
import { AuthProvider } from '../../../../../context/AuthContext';
import { formatDateOnly } from '../../../../../../lib/formatDate';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sched-1' }),
  useRouter: () => ({ push: pushMock }),
}));

const COACH_USER = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const SESSION = { _id: 'session-1', date: '2026-09-01T00:00:00.000Z', students: [{ studentId: 's1', isPresent: false }] };

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: COACH_USER })),
  http.get('*/group-class-sessions/by-schedule/:scheduleId', () => HttpResponse.json({ sessions: [SESSION] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <CoachSessionsPage />
    </AuthProvider>
  );
}

describe('CoachSessionsPage', () => {
  it('renders sessions for the schedule with a Mark Attendance link', async () => {
    renderPage();

    expect(await screen.findByText(formatDateOnly(SESSION.date))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mark attendance/i })).toHaveAttribute(
      'href',
      '/sessions/session-1/attendance'
    );
  });

  // session.date is a calendar-day sentinel — same regression guard as the
  // admin sessions page's own test (docs/plans/utc-date-standard-plan.md):
  // a sentinel stored at UTC midnight of Sep 1 must render "Sep 1", never a
  // browser-local shift to "Aug 31".
  describe('timezone rendering regression (bug fix)', () => {
    it("renders the sentinel's UTC calendar day, not a browser-local shift", async () => {
      renderPage();

      expect(await screen.findByText('Sep 1, 2026')).toBeInTheDocument();
    });
  });

  it('shows an error message on a failed fetch', async () => {
    server.use(
      http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load sessions.');
  });
});
