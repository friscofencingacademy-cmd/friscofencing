import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import BookTrialPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

// LEVEL_BEGINNER/LEVEL_ADVANCED + CLASS_A/CLASS_B's levelId link, same
// fixture convention as register/__tests__/page.test.tsx — the picker is
// level-driven now (a GroupClass's own `name` field can go stale relative
// to its Level's name when only the Level is renamed, which is exactly the
// bug this fixes). The level and its class are given two visibly DIFFERENT
// names here on purpose, so a passing test actually proves the level's own
// name is what renders, not a coincidentally-matching class name.
const LEVEL_BEGINNER = { _id: 'level-1', name: 'Beginner (Ages 10-13)', order: 1 };
const LEVEL_ADVANCED = { _id: 'level-2', name: 'Advanced', order: 2 };

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil', levelId: LEVEL_BEGINNER._id, locationId: 'loc-1', capacity: 10 };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee', levelId: LEVEL_ADVANCED._id, locationId: 'loc-1', capacity: 10 };

// The session already carries its own schedule's day/time (populated by the
// backend) — no separate schedule selection any more.
const SESSION_A = {
  _id: 'session-a',
  date: '2099-01-01T00:00:00.000Z',
  scheduleId: { _id: 'sched-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
};
const SESSION_B = {
  _id: 'session-b',
  date: '2099-01-08T00:00:00.000Z',
  scheduleId: { _id: 'sched-2', dayOfWeek: 4, startTime: '18:00', endTime: '19:00' },
};

let postPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [LEVEL_BEGINNER, LEVEL_ADVANCED] })),
  http.get('*/group-class-sessions/by-class/:classId', () =>
    HttpResponse.json({ sessions: [SESSION_A, SESSION_B] })
  ),
  http.post('*/trial-classes', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json({ trialClass: { _id: 'trial-1' } }, { status: 201 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  postPayload = null;
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderBookTrialPage() {
  return render(
    <ParentPortalProvider>
      <BookTrialPage />
    </ParentPortalProvider>
  );
}

describe('BookTrialPage wizard', () => {
  it('walks Who -> Pick a Level -> Confirmation and submits { studentId, sessionId }', async () => {
    renderBookTrialPage();

    // Step 0: Who
    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    fireEvent.click(childCard);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 1: Pick a Level — no separate class/schedule step any more;
    // picking a level resolves to its class(es) internally and goes
    // straight to a session picker (pills), merged across all of them.
    await screen.findByLabelText('Level');
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: LEVEL_BEGINNER._id } });

    const sessionA = await screen.findByRole('radio', { name: /4:00 PM–5:00 PM/i });
    const sessionB = screen.getByRole('radio', { name: /6:00 PM–7:00 PM/i });
    expect(sessionA).toBeInTheDocument();
    expect(sessionB).toBeInTheDocument();

    fireEvent.click(sessionA);

    fireEvent.click(screen.getByRole('button', { name: /book trial class/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ studentId: STUDENT._id, sessionId: SESSION_A._id });
    });

    // Step 2: Confirmation — a single "Back to Dashboard" CTA only. A
    // second "Register for a Class" link used to render alongside it; the
    // owner asked for a clean trial-only confirmation with no register
    // prompt.
    expect(await screen.findByText('Trial class booked!')).toBeInTheDocument();
    expect(screen.getByText('Kid One')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /register for a class/i })).not.toBeInTheDocument();
  });

  // Regression guard for the reported bug: the picker used to show a
  // GroupClass's own `name` field, which drifts stale the moment an admin
  // renames the Level without also renaming the matching class. It must
  // show the Level's own (always-live) name instead, and never the class's.
  describe('level name regression (bug fix)', () => {
    it('shows each Level\'s own name in the picker, never the underlying GroupClass name', async () => {
      renderBookTrialPage();

      fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      const levelSelect = await screen.findByLabelText('Level');
      expect(within(levelSelect).getByText(LEVEL_BEGINNER.name)).toBeInTheDocument();
      expect(within(levelSelect).getByText(LEVEL_ADVANCED.name)).toBeInTheDocument();
      expect(within(levelSelect).queryByText(CLASS_A.name)).not.toBeInTheDocument();
      expect(within(levelSelect).queryByText(CLASS_B.name)).not.toBeInTheDocument();
    });
  });

  it('preselects the child from the ?child= deep link', async () => {
    mockSearchParams = new URLSearchParams({ child: STUDENT._id });

    renderBookTrialPage();

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('back-navigation from step 1 to step 0 preserves the selected child', async () => {
    renderBookTrialPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Level');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an inline error on a booking failure without crashing, and stays on the same step', async () => {
    renderBookTrialPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Level');
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: LEVEL_BEGINNER._id } });
    fireEvent.click(await screen.findByRole('radio', { name: /4:00 PM–5:00 PM/i }));

    server.use(
      http.post('*/trial-classes', () =>
        HttpResponse.json({ message: 'This student has already used their trial class' }, { status: 409 })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /book trial class/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This student has already used their trial class');
    });

    // Still on step 1 — the level select is still visible.
    expect(screen.getByLabelText('Level')).toBeInTheDocument();
  });
});

// The same-day-session regression test that used to live here (freezing
// the clock, asserting a session dated at today's midnight is still
// offered) moved to the backend: the date-range filtering itself moved
// server-side (listUpcomingByClass, GET /group-class-sessions/by-class/:id)
// when the schedule-selection step was removed, so the frontend no longer
// has any "today" comparison of its own left to regress. See
// backend/tests/routes/groupClassSession.routes.test.js's "includes only
// sessions within the next 30 days (today-inclusive)..." test.
