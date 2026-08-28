import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ClassesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

// No `availability` field — matches the live default (premium mode), where
// the backend omits it entirely (docs/plans/premium-registration-and-
// attendance-plan.md §0/§4; groupClassSchedule.service.js's listPublic()).
const OPEN_SCHEDULE = {
  className: 'Beginner Foil',
  levelName: 'Beginner',
  locationName: 'Frisco HQ',
  coachName: 'Jane Smith',
  dayOfWeek: 3,
  startTime: '16:00',
  endTime: '17:00',
};

const ADVANCED_SCHEDULE = {
  className: 'Advanced Foil',
  levelName: 'Advanced',
  locationName: 'Frisco HQ',
  coachName: 'Sam Lee',
  dayOfWeek: 3,
  startTime: '18:00',
  endTime: '19:00',
};

const LOCATION = { name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago' };

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/group-class-schedules/public', () =>
    HttpResponse.json({ schedules: [OPEN_SCHEDULE, ADVANCED_SCHEDULE] })
  ),
  http.get('*/locations/public', () => HttpResponse.json({ locations: [LOCATION] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <ClassesPage />
    </AuthProvider>
  );
}

describe('ClassesPage', () => {
  it('groups schedules by day, shows the timezone, and renders an enabled Book link with no availability pill in premium mode (the live default)', async () => {
    renderPage();

    expect(await screen.findByText(/all times shown in america\/chicago/i)).toBeInTheDocument();
    expect(screen.getByText('Wednesday')).toBeInTheDocument();
    expect(screen.getByText(/beginner foil · beginner/i)).toBeInTheDocument();
    expect(screen.getByText(/4:00 pm–5:00 pm · frisco hq · coach jane smith/i)).toBeInTheDocument();

    // No `availability` field on the wire (premium mode) → no pill at all,
    // for either row — not even "Open".
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(screen.queryByText('Class full')).not.toBeInTheDocument();

    // Every row books freely: two schedules in, two enabled links out.
    // AppShell's own public-nav CTA shares this accessible name, so this
    // finds the rows' links by their distinct href rather than by position.
    const bookLinks = screen.getAllByRole('link', { name: /book a free trial/i });
    const registerLinks = bookLinks.filter(
      (link) => link.getAttribute('href') === '/register?next=/parent/book-trial'
    );
    expect(registerLinks).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /book a free trial/i })).not.toBeInTheDocument();
  });

  it('renders a disabled Book button and a "Class full" pill for a full class in schedule-based mode', async () => {
    // The only mode where the backend still sends `availability` at all
    // (ENABLE_SCHEDULE_BASED_REGISTRATION=true) — see groupClassSchedule.
    // service.js's listPublic().
    server.use(
      http.get('*/group-class-schedules/public', () =>
        HttpResponse.json({
          schedules: [
            { ...OPEN_SCHEDULE, availability: 'open' },
            { ...ADVANCED_SCHEDULE, availability: 'full' },
          ],
        })
      )
    );

    renderPage();

    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Class full')).toBeInTheDocument();

    const bookButtons = screen.getAllByRole('button', { name: /book a free trial/i });
    expect(bookButtons).toHaveLength(1);
    expect(bookButtons[0]).toBeDisabled();
  });

  it('filters the list by level', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/beginner foil · beginner/i);
    expect(screen.getByText(/advanced foil · advanced/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Level'), 'Beginner');

    expect(screen.getByText(/beginner foil · beginner/i)).toBeInTheDocument();
    expect(screen.queryByText(/advanced foil · advanced/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when no classes are scheduled', async () => {
    server.use(
      http.get('*/group-class-schedules/public', () => HttpResponse.json({ schedules: [] }))
    );

    renderPage();

    expect(await screen.findByText(/no classes are scheduled right now/i)).toBeInTheDocument();
  });

  it('shows LoadError with a working retry on a failed fetch', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/group-class-schedules/public', () =>
        HttpResponse.json({ message: 'Failed to list schedules' }, { status: 500 })
      )
    );

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(
      http.get('*/group-class-schedules/public', () =>
        HttpResponse.json({ schedules: [OPEN_SCHEDULE] })
      )
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/beginner foil · beginner/i)).toBeInTheDocument();
  });
});
