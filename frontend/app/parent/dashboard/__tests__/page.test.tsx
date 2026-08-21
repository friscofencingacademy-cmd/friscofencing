import { render, screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ParentDashboardPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

const STUDENT_ENROLLED = { _id: 'student-1', firstName: 'Enrolled', lastName: 'Kid' };
const STUDENT_TRIAL = { _id: 'student-2', firstName: 'Trial', lastName: 'Kid' };
const STUDENT_NONE = { _id: 'student-3', firstName: 'New', lastName: 'Kid' };

const SUBSCRIPTION = {
  _id: 'sub-1',
  studentId: STUDENT_ENROLLED,
  scheduleId: { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] },
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  nextBillingDate: '2026-02-01T00:00:00.000Z',
  lastChargeAmount: 150,
};

const TRIAL_CLASS = {
  _id: 'trial-1',
  studentId: STUDENT_TRIAL,
  sessionId: { _id: 'session-1', date: '2026-09-01T00:00:00.000Z' },
};

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] }))
);

beforeAll(() => server.listen());
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

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    expect(await screen.findByRole('dialog', { name: /add child/i })).toBeInTheDocument();
  });

  it('shows one at-a-glance card per child with the correct status and CTA, linking to the child detail page', async () => {
    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [STUDENT_ENROLLED, STUDENT_TRIAL, STUDENT_NONE] })
      ),
      http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] })),
      http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [TRIAL_CLASS] }))
    );

    renderDashboard();

    expect(await screen.findByText('Enrolled Kid')).toBeInTheDocument();
    expect(screen.getByText(/enrolled — wednesday 16:00-17:00/i)).toBeInTheDocument();
    expect(screen.getByText('Trial Kid')).toBeInTheDocument();
    expect(screen.getByText('Trial class scheduled')).toBeInTheDocument();
    expect(screen.getByText('New Kid')).toBeInTheDocument();
    expect(screen.getByText('Not enrolled')).toBeInTheDocument();

    // Only the not-enrolled child gets the "Book a free trial" CTA.
    expect(screen.getAllByRole('link', { name: /book a free trial/i })).toHaveLength(1);

    // Each child's name links to their detail page.
    expect(screen.getByRole('link', { name: /enrolled kid/i })).toHaveAttribute(
      'href',
      `/parent/child/${STUDENT_ENROLLED._id}`
    );
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
