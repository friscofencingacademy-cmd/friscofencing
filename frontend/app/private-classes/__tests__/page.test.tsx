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
      startTime: '16:00',
      displayTime: '16:00',
      durationMinutes: 60,
      sessionPrice: 65,
      hourlyRate: 65,
      firstSessionDate: '2026-09-01T16:00:00.000Z',
    },
  ],
};

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/private-class-schedules/public', () => HttpResponse.json({ coaches: [COACH_WITH_SLOTS] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
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
    expect(screen.getByText(/tuesday · 16:00 · 60 min/i)).toBeInTheDocument();
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
});
