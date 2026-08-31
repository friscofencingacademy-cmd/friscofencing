import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SessionsPage from '../page';
import { formatDateOnly } from '../../../../../../lib/formatDate';

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

    expect(await screen.findByText(formatDateOnly(SESSION.date))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mark attendance/i })).toHaveAttribute(
      'href',
      '/sessions/session-1/attendance'
    );
  });

  // session.date is a calendar-day sentinel — regression guard for the
  // Sunday-for-Monday timezone bug (docs/plans/utc-date-standard-plan.md):
  // a sentinel stored at UTC midnight of Sep 1 must render "Sep 1", never
  // "Aug 31", regardless of the machine running the test.
  describe('timezone rendering regression (bug fix)', () => {
    it('renders the sentinel\'s UTC calendar day, not a browser-local shift', async () => {
      render(<SessionsPage />);

      expect(await screen.findByText('Sep 1, 2026')).toBeInTheDocument();
    });
  });

  // docs/plans/holiday-blocking-plan.md D6 — a holiday-date session is
  // annotated and rendered greyed with no attendance link, not dropped.
  describe('holiday-date session (docs/plans/holiday-blocking-plan.md D6)', () => {
    it('renders a "Holiday — <name>" chip instead of the student count, with no Mark Attendance link', async () => {
      const holidaySession = {
        _id: 'session-2',
        date: '2026-12-25T00:00:00.000Z',
        students: [],
        isHoliday: true,
        holidayName: 'Christmas',
      };
      server.use(
        http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
          HttpResponse.json({ sessions: [holidaySession] })
        )
      );

      render(<SessionsPage />);

      expect(await screen.findByText('Holiday — Christmas')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /mark attendance/i })).not.toBeInTheDocument();
    });

    it('a non-holiday session in the same list keeps its normal Mark Attendance link', async () => {
      const holidaySession = {
        _id: 'session-2',
        date: '2026-12-25T00:00:00.000Z',
        students: [],
        isHoliday: true,
        holidayName: 'Christmas',
      };
      server.use(
        http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
          HttpResponse.json({ sessions: [SESSION, holidaySession] })
        )
      );

      render(<SessionsPage />);

      await screen.findByText('Holiday — Christmas');
      expect(screen.getByRole('link', { name: /mark attendance/i })).toHaveAttribute(
        'href',
        '/sessions/session-1/attendance'
      );
    });
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
