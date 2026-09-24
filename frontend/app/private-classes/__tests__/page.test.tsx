import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PrivateClassesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';
import type { PublicPrivateLessons } from '../../../lib/types';

const LESSONS: PublicPrivateLessons = {
  coaches: [
    {
      coachId: 'coach-1',
      coachName: 'Dana Cole',
      slots: [
        {
          scheduleId: 'sched-1',
          dayOfWeek: 2,
          dayName: 'Tuesday',
          // Raw "HH:mm" — the page formats it (a 24-hour time once shipped to
          // parents).
          startTime: '16:30',
          durationMinutes: 30,
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-12-31T00:00:00.000Z',
          // Deliberately not rate x length: the page must show this server
          // value, never compute one.
          sessionPrice: 31.99,
          hourlyRate: 65,
        },
      ],
    },
  ],
  packageOffers: [
    { quantity: 1, discountPercent: 0 },
    { quantity: 10, discountPercent: 10 },
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
  http.get('*/private-class-schedules/public', () => HttpResponse.json(LESSONS))
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
  it("renders each coach's slots with the server price and the bookable range, and a parent's button opens the wizard", async () => {
    authMeStatus = 200;
    authMeUser = PARENT_USER;

    renderPage();

    expect(await screen.findByText('Dana Cole')).toBeInTheDocument();
    expect(screen.getByText('Tuesdays · 4:30 PM · 30 min')).toBeInTheDocument();
    expect(screen.queryByText(/16:30/)).not.toBeInTheDocument();
    expect(screen.getByText('$31.99 / session · Open Oct 1, 2026 – Dec 31, 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pick a date/i })).toHaveAttribute(
      'href',
      '/parent/register-private?slot=sched-1'
    );
    expect(screen.queryByText(/register/i)).not.toBeInTheDocument();
  });

  it('lists the academy packs (the always-offered single session is not a "pack")', async () => {
    renderPage();

    expect(await screen.findByText('Save with a pack: 10 sessions, 10% off')).toBeInTheDocument();
  });

  it('sends a logged-out visitor to log in first, carrying the slot, and offers registration', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: /pick a date/i });
    expect(link).toHaveAttribute('href', `/login?next=${encodeURIComponent('/parent/register-private?slot=sched-1')}`);
    expect(await screen.findByRole('link', { name: /^register$/i })).toHaveAttribute('href', '/register');
  });

  it('shows an empty state when no coach has open times, and no packs line when none are configured', async () => {
    server.use(
      http.get('*/private-class-schedules/public', () =>
        HttpResponse.json({ coaches: [], packageOffers: [{ quantity: 1, discountPercent: 0 }] })
      )
    );

    renderPage();

    expect(await screen.findByText(/no private lesson times are open/i)).toBeInTheDocument();
    expect(screen.queryByText(/save with a pack/i)).not.toBeInTheDocument();
  });

  it('renders LoadError with a working retry on a failed load', async () => {
    server.use(
      http.get('*/private-class-schedules/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(http.get('*/private-class-schedules/public', () => HttpResponse.json(LESSONS)));
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Dana Cole')).toBeInTheDocument();
  });
});
