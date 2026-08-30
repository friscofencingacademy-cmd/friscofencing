import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ClassesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

// No `availability` field — matches the live default (premium mode), where
// the backend omits it entirely (docs/plans/premium-registration-and-
// attendance-plan.md §0/§4; groupClassSchedule.service.js's listPublic()).
// `timezone` (docs/plans/frontend-polish-plan.md PR 4) is per-row, sourced
// from that schedule's own location — never guessed from a separate
// locations fetch.
const OPEN_SCHEDULE = {
  className: 'Beginner Foil',
  levelName: 'Beginner',
  locationName: 'Frisco HQ',
  timezone: 'America/Chicago',
  coachName: 'Jane Smith',
  dayOfWeek: 3,
  startTime: '16:00',
  endTime: '17:00',
};

const ADVANCED_SCHEDULE = {
  className: 'Advanced Foil',
  levelName: 'Advanced',
  locationName: 'Frisco HQ',
  timezone: 'America/Chicago',
  coachName: 'Sam Lee',
  dayOfWeek: 3,
  startTime: '18:00',
  endTime: '19:00',
};

const LOCATION = { name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago' };

// Catalog order deliberately disagrees with alphabetical order (Advanced
// comes first here) — proves the filter renders in catalog order, not
// `.sort()`'d, and INTERMEDIATE has zero scheduled sessions — proves a
// level with no rows still appears (finding B4).
const LEVEL_ADVANCED = { name: 'Advanced', order: 1, monthlyFee: 200 };
const LEVEL_BEGINNER = { name: 'Beginner', order: 2, monthlyFee: 150 };
const LEVEL_INTERMEDIATE = { name: 'Intermediate', order: 3, monthlyFee: 175 };

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/group-class-schedules/public', () =>
    HttpResponse.json({ schedules: [OPEN_SCHEDULE, ADVANCED_SCHEDULE] })
  ),
  http.get('*/locations/public', () => HttpResponse.json({ locations: [LOCATION] })),
  http.get('*/levels/public', () =>
    HttpResponse.json({ levels: [LEVEL_ADVANCED, LEVEL_BEGINNER, LEVEL_INTERMEDIATE] })
  )
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
  it('groups schedules by day, shows the single shared timezone, and renders an enabled Book link with no availability pill in premium mode (the live default)', async () => {
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

  // Named per TESTING_STRATEGY's regression-naming convention — the bug the
  // original design brief's own first draft would have kept: guessing a
  // single timezone from data?.locations[0], regardless of which location a
  // given row actually belongs to.
  describe('per-row timezone regression (source-of-truth audit finding B2)', () => {
    it('drops the single page-level timezone line and shows each row\'s own zone when schedules span more than one timezone', async () => {
      server.use(
        http.get('*/group-class-schedules/public', () =>
          HttpResponse.json({
            schedules: [OPEN_SCHEDULE, { ...ADVANCED_SCHEDULE, timezone: 'America/Denver' }],
          })
        )
      );

      renderPage();

      await screen.findByText(/beginner foil · beginner/i);

      expect(screen.queryByText(/all times shown in/i)).not.toBeInTheDocument();
      expect(screen.getByText(/coach jane smith · america\/chicago/i)).toBeInTheDocument();
      expect(screen.getByText(/coach sam lee · america\/denver/i)).toBeInTheDocument();
    });
  });

  describe('level filter (source-of-truth audit finding B4)', () => {
    it('lists filter options in catalog order (not alphabetical), including a level with zero scheduled sessions', async () => {
      renderPage();

      await screen.findByText(/beginner foil · beginner/i);

      const pillGroup = screen.getByRole('radiogroup', { name: /filter by level/i });
      const pillLabels = within(pillGroup)
        .getAllByRole('radio')
        .map((pill) => pill.textContent);

      // Catalog order: All levels, Advanced (order 1), Beginner (order 2),
      // Intermediate (order 3, zero schedules) — never alphabetical, never
      // derived from which rows arrived.
      expect(pillLabels).toEqual(['All levels', 'Advanced', 'Beginner', 'Intermediate']);
    });

    it('filters the list by level via the pill row, updating aria-checked', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText(/beginner foil · beginner/i);
      expect(screen.getByText(/advanced foil · advanced/i)).toBeInTheDocument();

      const beginnerPill = screen.getByRole('radio', { name: 'Beginner' });
      await user.click(beginnerPill);

      expect(beginnerPill).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'All levels' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText(/beginner foil · beginner/i)).toBeInTheDocument();
      expect(screen.queryByText(/advanced foil · advanced/i)).not.toBeInTheDocument();
    });

    it('filters the list by level via the <select>, driving the same state as the pill row', async () => {
      const user = userEvent.setup();
      renderPage();

      await screen.findByText(/beginner foil · beginner/i);
      expect(screen.getByText(/advanced foil · advanced/i)).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Level'), 'Beginner');

      expect(screen.getByText(/beginner foil · beginner/i)).toBeInTheDocument();
      expect(screen.queryByText(/advanced foil · advanced/i)).not.toBeInTheDocument();
      // The pill row reflects the same selection made via the <select>.
      expect(screen.getByRole('radio', { name: 'Beginner' })).toHaveAttribute('aria-checked', 'true');
    });

    it('degrades to "All levels" only — never a LoadError, never a crash — when /levels/public fails but schedules still load', async () => {
      server.use(
        http.get('*/levels/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
      );

      renderPage();

      expect(await screen.findByText(/beginner foil · beginner/i)).toBeInTheDocument();
      expect(screen.getByText(/advanced foil · advanced/i)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      const pillGroup = screen.getByRole('radiogroup', { name: /filter by level/i });
      expect(within(pillGroup).getAllByRole('radio')).toHaveLength(1);
      expect(within(pillGroup).getByRole('radio', { name: 'All levels' })).toBeInTheDocument();
    });
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
