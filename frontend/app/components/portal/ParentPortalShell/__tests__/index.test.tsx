import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ParentPortalShell from '../index';
import { AuthProvider } from '../../../../context/AuthContext';
import { ParentPortalProvider } from '../../../../context/ParentPortalContext';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parent/dashboard',
}));

const PARENT_USER = { _id: 'parent-1', role: 'parent', firstName: 'Par', lastName: 'Ent', email: 'parent@example.com' };

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
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () =>
    HttpResponse.json({ students: [STUDENT_ENROLLED, STUDENT_TRIAL, STUDENT_NONE] })
  ),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [TRIAL_CLASS] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderShell() {
  return render(
    <AuthProvider>
      <ParentPortalProvider>
        <ParentPortalShell>
          <p>Dashboard body</p>
        </ParentPortalShell>
      </ParentPortalProvider>
    </AuthProvider>
  );
}

describe('ParentPortalShell', () => {
  it('renders a row per child with the correct status meta line, linking to the child detail page', async () => {
    renderShell();

    expect(await screen.findByText('Enrolled Kid')).toBeInTheDocument();
    expect(screen.getByText('Trial Kid')).toBeInTheDocument();
    expect(screen.getByText('New Kid')).toBeInTheDocument();

    expect(screen.getByText('Enrolled')).toBeInTheDocument();
    expect(screen.getByText('Trial booked')).toBeInTheDocument();
    expect(screen.getByText('Not enrolled')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /enrolled kid/i })).toHaveAttribute(
      'href',
      `/parent/child/${STUDENT_ENROLLED._id}`
    );
  });

  it('renders a "+ Add child" button that opens the AddChildModal', async () => {
    renderShell();
    await screen.findByText('Enrolled Kid');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByRole('dialog', { name: /add child/i })).toBeInTheDocument();
  });

  it('renders the header greeting and children-count chip', async () => {
    renderShell();

    expect(await screen.findByText(/welcome back, par/i)).toBeInTheDocument();
    expect(screen.getByText('3 children')).toBeInTheDocument();
  });

  it('renders the page content passed as children', async () => {
    renderShell();

    expect(await screen.findByText('Dashboard body')).toBeInTheDocument();
  });

  it('logs out and clears the session when "Log out" is clicked', async () => {
    let logoutCalled = false;
    server.use(
      http.post('*/auth/logout', () => {
        logoutCalled = true;
        return HttpResponse.json({ success: true });
      })
    );

    renderShell();
    await screen.findByText('Enrolled Kid');

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });
});
