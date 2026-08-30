import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChildDetailPage from '../page';
import { ParentPortalProvider } from '../../../../context/ParentPortalContext';

let mockParams = { id: 'student-1' };
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useSearchParams: () => mockSearchParams,
}));

// enrollment is server-decided (student.service.js's attachEnrollment(),
// docs/plans/frontend-polish-plan.md PR 3) — set directly per fixture
// rather than left for the page to derive from subscriptions/trialClasses,
// since the page no longer derives status/CTA-gating at all. Kept
// consistent with each test's own /registrations/mine or /trial-classes/mine
// override below, matching what the real backend would compute together.
const STUDENT_BASE = { _id: 'student-1', firstName: 'Kid', lastName: 'One', skillLevel: 'beginner' };
const STUDENT_NOT_ENROLLED = {
  ...STUDENT_BASE,
  enrollment: { status: 'not_enrolled' as const, canBookTrial: true, schedule: null },
};
const STUDENT_ENROLLED = {
  ...STUDENT_BASE,
  enrollment: {
    status: 'enrolled' as const,
    canBookTrial: false,
    schedule: { dayOfWeek: 3, startTime: '16:00', endTime: '17:00' },
  },
};
const STUDENT_TRIAL_SCHEDULED = {
  ...STUDENT_BASE,
  enrollment: { status: 'trial_scheduled' as const, canBookTrial: false, schedule: null },
};
const STUDENT_TRIAL_COMPLETED = {
  ...STUDENT_BASE,
  enrollment: { status: 'trial_completed' as const, canBookTrial: false, schedule: null },
};

const SUBSCRIPTION = {
  _id: 'sub-1',
  studentId: STUDENT_BASE,
  scheduleId: { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] },
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  nextBillingDate: '2026-02-01T00:00:00.000Z',
  lastChargeAmount: 150,
};

const TRIAL_CLASS = {
  _id: 'trial-1',
  studentId: STUDENT_BASE,
  sessionId: { _id: 'session-1', date: '2026-09-01T00:00:00.000Z' },
};

const CLASS_SCHEDULES = [
  { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] },
  { _id: 'sched-2', classId: 'class-1', coachId: 'coach-2', dayOfWeek: 5, startTime: '18:00', endTime: '20:00', students: [] },
  { _id: 'sched-other', classId: 'class-other', coachId: 'coach-3', dayOfWeek: 1, startTime: '10:00', endTime: '11:00', students: [] },
];

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_NOT_ENROLLED] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: CLASS_SCHEDULES }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  mockParams = { id: 'student-1' };
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <ParentPortalProvider>
      <ChildDetailPage />
    </ParentPortalProvider>
  );
}

describe('ChildDetailPage', () => {
  it('renders the header with name, skill level, and status pill', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Kid One' })).toBeInTheDocument();
    expect(screen.getByText('beginner')).toBeInTheDocument();
    expect(screen.getByText('Not enrolled')).toBeInTheDocument();
  });

  it('defaults to the Overview tab and shows the "Not Enrolled" card (with its Book a Free Trial CTA) when canBookTrial is true', async () => {
    renderPage();

    const overviewTab = await screen.findByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Not Enrolled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book a free trial/i })).toHaveAttribute(
      'href',
      `/parent/book-trial?child=${STUDENT_NOT_ENROLLED._id}`
    );
  });

  it('shows the Trial Class card with the session date for a trial_scheduled child', async () => {
    server.use(
      http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_TRIAL_SCHEDULED] })),
      http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [TRIAL_CLASS] }))
    );

    renderPage();

    expect(await screen.findByText('Trial booked')).toBeInTheDocument();
    expect(screen.getByText('Trial Class')).toBeInTheDocument();
    expect(screen.getByText(/scheduled for/i)).toBeInTheDocument();
    // Not enrolled AND not a fresh not_enrolled — no "Not Enrolled" card,
    // no CTA (canBookTrial is false: the one trial is already spoken for).
    expect(screen.queryByText('Not Enrolled')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /book a free trial/i })).not.toBeInTheDocument();
  });

  // Named per TESTING_STRATEGY's regression-naming convention — the bug the
  // original design brief missed: before PR 3, a trial from months ago
  // still read as "Trial booked" forever on this page too, since the page
  // used to infer status from bare TrialClass existence with no date check.
  describe('stale "Trial class scheduled" regression (bug fix)', () => {
    it('shows a "Trial Completed" card and the Trial completed pill — never the stale "Trial booked" — for a trial_completed child', async () => {
      server.use(
        http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_TRIAL_COMPLETED] })),
        http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [TRIAL_CLASS] }))
      );

      renderPage();

      expect(await screen.findByText('Trial completed')).toBeInTheDocument();
      expect(screen.getByText('Trial Completed')).toBeInTheDocument();
      expect(screen.queryByText('Trial booked')).not.toBeInTheDocument();
      expect(screen.queryByText('Trial Class')).not.toBeInTheDocument();
      // canBookTrial is false — no trial CTA. Register is the only forward
      // action offered.
      expect(screen.queryByRole('link', { name: /book a free trial/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^register$/i })).toHaveAttribute(
        'href',
        `/parent/register?child=${STUDENT_TRIAL_COMPLETED._id}`
      );
    });
  });

  it('shows the Overview tab\'s active-registration card with a Billing entry point when enrolled', async () => {
    server.use(
      http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_ENROLLED] })),
      http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] }))
    );

    renderPage();

    expect(await screen.findByText('Active Registration')).toBeInTheDocument();
    expect(screen.getByText(/wednesday 4:00 pm-5:00 pm/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage \/ cancel in billing/i })).toHaveAttribute(
      'href',
      '/parent/subscriptions'
    );
    // The status pill reflects the server's enrollment decision, not a
    // local re-derivation from the subscriptions list.
    expect(screen.getByText('Enrolled')).toBeInTheDocument();
  });

  it('switches to the Schedule tab via the ?tab= URL param and shows the recurring pattern', async () => {
    server.use(
      http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_ENROLLED] })),
      http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] }))
    );
    mockSearchParams = new URLSearchParams({ tab: 'schedule' });

    renderPage();

    const scheduleTab = await screen.findByRole('tab', { name: 'Schedule' });
    expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/every wednesday, 4:00 pm - 5:00 pm/i)).toBeInTheDocument();
  });

  it('shows every sibling schedule of the class for a premium subscription, not just the one it\'s anchored to', async () => {
    server.use(
      http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT_ENROLLED] })),
      http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [{ ...SUBSCRIPTION, isPremium: true }] }))
    );
    mockSearchParams = new URLSearchParams({ tab: 'schedule' });

    renderPage();

    await screen.findByRole('tab', { name: 'Schedule' });
    expect(screen.getByText(/premium plan/i)).toBeInTheDocument();
    expect(screen.getByText(/every wednesday, 4:00 pm - 5:00 pm/i)).toBeInTheDocument();
    expect(screen.getByText(/every friday, 6:00 pm - 8:00 pm/i)).toBeInTheDocument();
    // A schedule under a DIFFERENT class must never leak in.
    expect(screen.queryByText(/monday/i)).not.toBeInTheDocument();
  });

  it('falls back to the Overview tab for an invalid ?tab= value', async () => {
    mockSearchParams = new URLSearchParams({ tab: 'bogus' });

    renderPage();

    const overviewTab = await screen.findByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows "Child not found" for an id that does not belong to this household', async () => {
    mockParams = { id: 'not-a-real-id' };

    renderPage();

    expect(await screen.findByText('Child not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to my children/i })).toHaveAttribute('href', '/parent/children');
  });
});
