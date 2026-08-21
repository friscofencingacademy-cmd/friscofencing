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

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One', skillLevel: 'beginner' };

const SUBSCRIPTION = {
  _id: 'sub-1',
  studentId: STUDENT,
  scheduleId: { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] },
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  nextBillingDate: '2026-02-01T00:00:00.000Z',
  lastChargeAmount: 150,
};

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] }))
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

  it('defaults to the Overview tab and shows the "Not Enrolled" card when there is no subscription or trial', async () => {
    renderPage();

    const overviewTab = await screen.findByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Not Enrolled')).toBeInTheDocument();
  });

  it('shows the Overview tab\'s active-registration card with a Billing entry point when enrolled', async () => {
    server.use(http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] })));

    renderPage();

    expect(await screen.findByText('Active Registration')).toBeInTheDocument();
    expect(screen.getByText(/wednesday 16:00-17:00/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage \/ cancel in billing/i })).toHaveAttribute(
      'href',
      '/parent/subscriptions'
    );
  });

  it('switches to the Schedule tab via the ?tab= URL param and shows the recurring pattern', async () => {
    server.use(http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [SUBSCRIPTION] })));
    mockSearchParams = new URLSearchParams({ tab: 'schedule' });

    renderPage();

    const scheduleTab = await screen.findByRole('tab', { name: 'Schedule' });
    expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/every wednesday, 16:00 - 17:00/i)).toBeInTheDocument();
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
