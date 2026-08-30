import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PrivateClassesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

const COACH_WITH_SLOTS = {
  coachId: 'coach-1',
  coachName: 'Dana Cole',
  slots: [
    {
      scheduleId: 'sched-1',
      dayOfWeek: 2,
      dayName: 'Tuesday',
      // Raw "HH:mm" — no displayTime field (see PublicPrivateClassSlot's
      // own comment). The page formats it; this fixture matches the real
      // wire shape.
      startTime: '16:00',
      durationMinutes: 60,
      sessionPrice: 65,
      hourlyRate: 65,
      firstSessionDate: '2026-09-01T16:00:00.000Z',
    },
  ],
};

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Pat',
  lastName: 'Rivera',
  email: 'pat@example.com',
};

let authMeStatus = 401;
let authMeUser: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () =>
    authMeStatus === 200
      ? HttpResponse.json({ user: authMeUser })
      : HttpResponse.json({ message: 'unauthorized' }, { status: 401 })
  ),
  http.get('*/private-class-schedules/public', () => HttpResponse.json({ coaches: [COACH_WITH_SLOTS] }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  authMeStatus = 401;
  authMeUser = null;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <PrivateClassesPage />
    </AuthProvider>
  );
}

describe('PrivateClassesPage', () => {
  it('renders a coach card with slot day/time/price and a Book button carrying the scheduleId', async () => {
    renderPage();

    expect(await screen.findByText('Dana Cole')).toBeInTheDocument();
    // Named regression: this used to assert the raw "16:00" — a real bug
    // (24-hour time shipped to parents) that a wrong-but-passing assertion
    // locked in as "correct." Must read 4:00 PM.
    expect(screen.getByText(/tuesday · 4:00 pm · 60 min/i)).toBeInTheDocument();
    expect(screen.queryByText(/16:00/)).not.toBeInTheDocument();
    expect(screen.getByText(/\$65\.00 \/ session/i)).toBeInTheDocument();

    const bookLink = screen.getByRole('link', { name: /book this slot/i });
    expect(bookLink).toHaveAttribute('href', '/parent/register-private?slot=sched-1');
  });

  it('shows the empty state when no slots are open', async () => {
    server.use(http.get('*/private-class-schedules/public', () => HttpResponse.json({ coaches: [] })));

    renderPage();

    expect(
      await screen.findByText(/no private lesson slots are open right now/i)
    ).toBeInTheDocument();
  });

  it('shows the "don\'t have an account" prompt for a logged-out visitor', async () => {
    renderPage();

    await screen.findByText('Dana Cole');
    expect(screen.getByText(/don't have an account yet/i)).toBeInTheDocument();
  });

  it('never shows the "don\'t have an account" prompt once a parent is logged in', async () => {
    authMeStatus = 200;
    authMeUser = PARENT_USER;

    renderPage();

    await screen.findByText('Dana Cole');
    expect(screen.queryByText(/don't have an account yet/i)).not.toBeInTheDocument();
  });
});
