import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CoachPrivateStudentsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const COACH_USER = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const UNMARKED_SESSION = {
  _id: 'session-1',
  scheduleId: 'sched-1',
  enrollmentId: 'penroll-1',
  coachId: 'coach-1',
  studentId: { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' },
  parentId: { _id: 'parent-1', firstName: 'Pat', lastName: 'Parent' },
  startDate: '2026-08-25T16:00:00.000Z',
  endDate: '2026-08-25T17:00:00.000Z',
  attendance: 'scheduled',
  markedBy: null,
  markedAt: null,
  sessionPrice: 65,
};

const UPCOMING_SESSION = {
  ...UNMARKED_SESSION,
  _id: 'session-2',
  studentId: { _id: 'student-2', firstName: 'Robin', lastName: 'Kid' },
  startDate: '2026-09-01T16:00:00.000Z',
  endDate: '2026-09-01T17:00:00.000Z',
};

interface AttendanceMockResponse {
  session: typeof UNMARKED_SESSION;
  charged: boolean;
  chargeStatus: 'completed' | 'failed';
  charge: { _id: string; status: string; amount: number };
}

let attendancePayload: unknown = null;
let retryCalledFor: string | null = null;
let attendanceResponse: AttendanceMockResponse = {
  session: { ...UNMARKED_SESSION, attendance: 'attended' },
  charged: true,
  chargeStatus: 'completed',
  charge: { _id: 'charge-1', status: 'completed', amount: 65 },
};

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: COACH_USER })),
  http.get('*/private-class-sessions/mine', ({ request }) => {
    const url = new URL(request.url);
    const window = url.searchParams.get('window');
    if (window === 'unmarked') return HttpResponse.json({ sessions: [UNMARKED_SESSION] });
    if (window === 'upcoming') return HttpResponse.json({ sessions: [UPCOMING_SESSION] });
    return HttpResponse.json({ sessions: [] });
  }),
  http.patch('*/private-class-sessions/:id/attendance', async ({ request }) => {
    attendancePayload = await request.json();
    return HttpResponse.json(attendanceResponse);
  }),
  http.post('*/private-class-sessions/:id/retry-charge', ({ params }) => {
    retryCalledFor = params.id as string;
    return HttpResponse.json({
      session: { ...UNMARKED_SESSION, attendance: 'attended' },
      charged: true,
      chargeStatus: 'completed',
      charge: { _id: 'charge-2', status: 'completed', amount: 65 },
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  attendancePayload = null;
  retryCalledFor = null;
  attendanceResponse = {
    session: { ...UNMARKED_SESSION, attendance: 'attended' },
    charged: true,
    chargeStatus: 'completed',
    charge: { _id: 'charge-1', status: 'completed', amount: 65 },
  };
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <CoachPrivateStudentsPage />
    </AuthProvider>
  );
}

describe('CoachPrivateStudentsPage', () => {
  it('renders the unmarked list and shows the amount in the confirm dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Kid');

    await user.click(screen.getByRole('button', { name: /^attended$/i }));

    expect(await screen.findByText(/mark attended and charge/i)).toBeInTheDocument();
    expect(screen.getByText(/mark attended and charge pat parent's card \$65\.00/i)).toBeInTheDocument();
  });

  it('sends the attendance PATCH payload and renders a Charged result', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^attended$/i }));
    await screen.findByText(/mark attended and charge/i);
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(attendancePayload).toEqual({ status: 'attended' }));
    expect(await screen.findByText('Charged')).toBeInTheDocument();
  });

  it('shows a Charge failed result with a Retry charge button, and retry fires the retry endpoint', async () => {
    attendanceResponse = {
      session: { ...UNMARKED_SESSION, attendance: 'attended' },
      charged: false,
      chargeStatus: 'failed',
      charge: { _id: 'charge-1', status: 'failed', amount: 65 },
    };

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^attended$/i }));
    await screen.findByText(/mark attended and charge/i);
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(await screen.findByText('Charge failed')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /retry charge/i });

    await user.click(retryButton);

    await waitFor(() => expect(retryCalledFor).toBe('session-1'));
  });

  it('missed confirm dialog has no dollar amount', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Sam Kid');
    await user.click(screen.getByRole('button', { name: /^missed$/i }));

    const dialogText = await screen.findByText(/mark sam kid's session as missed/i);
    expect(dialogText).toBeInTheDocument();

    const dialog = dialogText.closest('.card') as HTMLElement;
    expect(within(dialog).queryByText(/\$65\.00/)).not.toBeInTheDocument();
  });

  it('renders the upcoming list read-only', async () => {
    renderPage();

    await screen.findByText('Sam Kid');
    expect(screen.getByText('Robin Kid')).toBeInTheDocument();
  });
});
