import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import BookTrialPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

// enrollment is server-decided (student.service.js's attachEnrollment()) —
// canBookTrial is what locks a child's card on this page.
const STUDENT = {
  _id: 'student-1',
  firstName: 'Kid',
  lastName: 'One',
  enrollment: { status: 'not_enrolled' as const, canBookTrial: true, schedule: null, trial: null },
};
const STUDENT_TRIAL_USED = {
  _id: 'student-2',
  firstName: 'Used',
  lastName: 'Trial',
  enrollment: { status: 'trial_completed' as const, canBookTrial: false, schedule: null, trial: null },
};
const STUDENT_TRIAL_BOOKED = {
  _id: 'student-3',
  firstName: 'Booked',
  lastName: 'Trial',
  enrollment: {
    status: 'trial_scheduled' as const,
    canBookTrial: false,
    schedule: null,
    trial: { startsAt: '2099-01-01T22:00:00.000Z', endsAt: '2099-01-01T23:00:00.000Z' },
  },
};
const STUDENT_ENROLLED = {
  _id: 'student-4',
  firstName: 'Enrolled',
  lastName: 'Kid',
  enrollment: {
    status: 'enrolled' as const,
    canBookTrial: false,
    schedule: { dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
    trial: null,
  },
};

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

beforeAll(() => server.listen({ onUnhandledRequest }));
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
  it('walks the sequential Who -> Level -> Session form and submits { studentId, sessionId }, with a single always-visible "Book Trial Class" CTA', async () => {
    renderBookTrialPage();

    // No "Continue" button ever renders — the CTA is always the final
    // action (docs/plans/booking-flow-sequential-plan.md D3).
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /book trial class/i });
    expect(cta).toBeDisabled();

    // Picking a child reveals the Level section below it — the child card
    // stays on screen, never replaced.
    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    await user.click(childCard);

    await screen.findByLabelText('Level');
    expect(childCard).toBeInTheDocument();
    expect(childCard).toHaveAttribute('aria-checked', 'true');

    // Picking a level reveals the Session section below it — Who and Level
    // both stay on screen.
    await user.selectOptions(screen.getByLabelText('Level'), LEVEL_BEGINNER._id);

    const sessionA = await screen.findByRole('radio', { name: /4:00 PM–5:00 PM/i });
    const sessionB = screen.getByRole('radio', { name: /6:00 PM–7:00 PM/i });
    expect(sessionA).toBeInTheDocument();
    expect(sessionB).toBeInTheDocument();
    expect(screen.getByLabelText('Level')).toBeInTheDocument();

    await user.click(sessionA);
    expect(cta).not.toBeDisabled();

    await user.click(cta);

    await waitFor(() => {
      expect(postPayload).toEqual({ studentId: STUDENT._id, sessionId: SESSION_A._id });
    });

    // Confirmation — a single "Back to Dashboard" CTA only. A second
    // "Register for a Class" link used to render alongside it; the owner
    // asked for a clean trial-only confirmation with no register prompt.
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

      await user.click(await screen.findByRole('radio', { name: /kid one/i }));

      const levelSelect = await screen.findByLabelText('Level');
      expect(within(levelSelect).getByText(LEVEL_BEGINNER.name)).toBeInTheDocument();
      expect(within(levelSelect).getByText(LEVEL_ADVANCED.name)).toBeInTheDocument();
      expect(within(levelSelect).queryByText(CLASS_A.name)).not.toBeInTheDocument();
      expect(within(levelSelect).queryByText(CLASS_B.name)).not.toBeInTheDocument();
    });
  });

  it('preselects the child from the ?child= deep link, revealing the Level section immediately', async () => {
    mockSearchParams = new URLSearchParams({ child: STUDENT._id });

    renderBookTrialPage();

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText('Level')).toBeInTheDocument();
  });

  // The reported bug: an ineligible child could be picked and walked all the
  // way to "Book Trial Class" before the POST's 409 said no. The card is now
  // locked up front from the server's canBookTrial, with the reason under it.
  describe('trial eligibility shown at the child step (bug fix)', () => {
    it('greys out every child who cannot book a trial, with the reason under each, and leaves eligible children selectable', async () => {
      server.use(
        http.get('*/students/mine', () =>
          HttpResponse.json({ students: [STUDENT, STUDENT_TRIAL_USED, STUDENT_TRIAL_BOOKED, STUDENT_ENROLLED] })
        )
      );

      renderBookTrialPage();

      const usedCard = await screen.findByRole('radio', { name: /used trial/i });
      expect(usedCard).toBeDisabled();
      expect(within(usedCard).getByText('Already used their free trial')).toBeInTheDocument();

      const bookedCard = screen.getByRole('radio', { name: /booked trial/i });
      expect(bookedCard).toBeDisabled();
      expect(within(bookedCard).getByText('Trial already booked')).toBeInTheDocument();

      const enrolledCard = screen.getByRole('radio', { name: /enrolled kid/i });
      expect(enrolledCard).toBeDisabled();
      expect(within(enrolledCard).getByText('Already enrolled')).toBeInTheDocument();

      // Clicking a locked card selects nothing — the Level step never opens.
      await user.click(usedCard);
      expect(usedCard).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByLabelText('Level')).not.toBeInTheDocument();

      // The eligible child is untouched.
      const eligibleCard = screen.getByRole('radio', { name: /kid one/i });
      expect(eligibleCard).toBeEnabled();
      await user.click(eligibleCard);
      expect(await screen.findByLabelText('Level')).toBeInTheDocument();
      expect(screen.queryByText(/none of your children can book a trial/i)).not.toBeInTheDocument();
    });

    it('ignores a ?child= deep link to a child who cannot book a trial', async () => {
      server.use(
        http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT, STUDENT_TRIAL_USED] }))
      );
      mockSearchParams = new URLSearchParams({ child: STUDENT_TRIAL_USED._id });

      renderBookTrialPage();

      const usedCard = await screen.findByRole('radio', { name: /used trial/i });
      expect(usedCard).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByLabelText('Level')).not.toBeInTheDocument();
    });

    it('points to Register when no child in the family can book a trial', async () => {
      server.use(
        http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_TRIAL_USED, STUDENT_ENROLLED] }))
      );

      renderBookTrialPage();

      expect(await screen.findByText(/none of your children can book a trial/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /register for a class/i })).toHaveAttribute('href', '/parent/register');
    });
  });

  it('picking a different child keeps the Level/Session sections in place, not a separate navigable step', async () => {
    renderBookTrialPage();

    await user.click(await screen.findByRole('radio', { name: /kid one/i }));
    await screen.findByLabelText('Level');
    await user.selectOptions(screen.getByLabelText('Level'), LEVEL_BEGINNER._id);
    await screen.findByRole('radio', { name: /4:00 PM–5:00 PM/i });

    // Re-clicking the (only) child card doesn't hide anything that was
    // already chosen — there's no "back" step to navigate away from.
    await user.click(screen.getByRole('radio', { name: /kid one/i }));

    expect(screen.getByRole('radio', { name: /kid one/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Level')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /4:00 PM–5:00 PM/i })).toBeInTheDocument();
  });

  it('shows an inline error on a booking failure without crashing, and keeps the form on screen', async () => {
    renderBookTrialPage();

    await user.click(await screen.findByRole('radio', { name: /kid one/i }));

    await screen.findByLabelText('Level');
    await user.selectOptions(screen.getByLabelText('Level'), LEVEL_BEGINNER._id);
    await user.click(await screen.findByRole('radio', { name: /4:00 PM–5:00 PM/i }));

    server.use(
      http.post('*/trial-classes', () =>
        HttpResponse.json({ message: 'This student has already used their trial class' }, { status: 409 })
      )
    );

    await user.click(screen.getByRole('button', { name: /book trial class/i }));

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
