import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import ParentDashboardPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

// enrollment is server-decided (student.service.js's attachEnrollment(),
// docs/plans/frontend-polish-plan.md PR 3) — these fixtures set it directly
// rather than relying on the page to derive it from subscriptions/
// trialClasses, since the page no longer does that at all.
const STUDENT_ENROLLED = {
  _id: 'student-1',
  firstName: 'Enrolled',
  lastName: 'Kid',
  enrollment: {
    status: 'enrolled' as const,
    canBookTrial: false,
    schedule: { dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
    trial: null,
  },
};
const STUDENT_TRIAL = {
  _id: 'student-2',
  firstName: 'Trial',
  lastName: 'Kid',
  // 21:00Z–22:00Z on Sep 1 2026 (CDT, UTC-5) is 4:00–5:00 PM Central.
  enrollment: {
    status: 'trial_scheduled' as const,
    canBookTrial: false,
    schedule: null,
    trial: { startsAt: '2026-09-01T21:00:00.000Z', endsAt: '2026-09-01T22:00:00.000Z' },
  },
};
const STUDENT_NONE = {
  _id: 'student-3',
  firstName: 'New',
  lastName: 'Kid',
  enrollment: { status: 'not_enrolled' as const, canBookTrial: true, schedule: null, trial: null },
};
// The previously-impossible-to-represent state this PR makes real (a trial
// from months ago no longer reads as "scheduled" forever) — canBookTrial is
// false here too (the one-trial-ever rule), so no CTA renders for this
// child either.
const STUDENT_TRIAL_COMPLETED = {
  _id: 'student-4',
  firstName: 'PastTrial',
  lastName: 'Kid',
  enrollment: { status: 'trial_completed' as const, canBookTrial: false, schedule: null, trial: null },
};

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderDashboard() {
  return render(
    <ParentPortalProvider>
      <ParentDashboardPage />
    </ParentPortalProvider>
  );
}

describe('ParentDashboardPage', () => {
  it('shows a loading state before context data resolves', () => {
    renderDashboard();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the onboarding stepper when the household has zero children, and its CTA opens the AddChildModal', async () => {
    renderDashboard();

    expect(await screen.findByText(/welcome to frisco fencing academy/i)).toBeInTheDocument();
    expect(screen.getByText('Account Created')).toBeInTheDocument();
    expect(screen.getByText('Add Your Child')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add child/i }));
    expect(await screen.findByRole('dialog', { name: /add child/i })).toBeInTheDocument();
  });

  it('shows one at-a-glance card per child with the correct status and CTA, linking to the child detail page', async () => {
    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [STUDENT_ENROLLED, STUDENT_TRIAL, STUDENT_NONE] })
      )
    );

    renderDashboard();

    expect(await screen.findByText('Enrolled Kid')).toBeInTheDocument();
    expect(screen.getByText(/enrolled — wednesday 4:00 pm-5:00 pm/i)).toBeInTheDocument();
    expect(screen.getByText('Trial Kid')).toBeInTheDocument();
    expect(screen.getByText('Trial class — Tue, Sep 1 · 4:00 PM–5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('New Kid')).toBeInTheDocument();
    expect(screen.getByText('Not enrolled')).toBeInTheDocument();

    // Only the not-enrolled child (canBookTrial: true) gets the "Book a
    // free trial" CTA — read directly off the server flag, never inferred.
    expect(screen.getAllByRole('link', { name: /book a free trial/i })).toHaveLength(1);

    // Each child's name links to their detail page.
    expect(screen.getByRole('link', { name: /enrolled kid/i })).toHaveAttribute(
      'href',
      `/parent/child/${STUDENT_ENROLLED._id}`
    );
  });

  // Named per TESTING_STRATEGY's regression-naming convention — the bug the
  // original design brief missed: before PR 3, a trial from months ago read
  // as "Trial class scheduled" forever, since TrialClass has no status
  // field and the page used to infer status from bare existence.
  describe('stale "Trial class scheduled" regression (bug fix)', () => {
    it('shows "Trial completed" — not "Trial class scheduled" — and no CTA, for a trial_completed child', async () => {
      server.use(
        http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_TRIAL_COMPLETED] }))
      );

      renderDashboard();

      expect(await screen.findByText('PastTrial Kid')).toBeInTheDocument();
      expect(screen.getByText('Trial completed')).toBeInTheDocument();
      expect(screen.queryByText('Trial class scheduled')).not.toBeInTheDocument();
      // canBookTrial is false for this state (one-trial-ever rule) — no CTA,
      // even though the child isn't currently enrolled.
      expect(screen.queryByRole('link', { name: /book a free trial/i })).not.toBeInTheDocument();
    });
  });

  it('falls back to "Trial class scheduled" when a scheduled trial arrives without its times', async () => {
    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [{ ...STUDENT_TRIAL, enrollment: { ...STUDENT_TRIAL.enrollment, trial: null } }] })
      )
    );

    renderDashboard();

    expect(await screen.findByText('Trial Kid')).toBeInTheDocument();
    expect(screen.getByText('Trial class scheduled')).toBeInTheDocument();
  });

  it('renders the Quick Actions rail', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_ENROLLED] })));

    renderDashboard();

    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book trial/i })).toHaveAttribute('href', '/parent/book-trial');
    expect(screen.getByRole('link', { name: /^register$/i })).toHaveAttribute('href', '/parent/register');
    expect(screen.getByRole('link', { name: /payment method/i })).toHaveAttribute('href', '/parent/payment-method');
  });
});
