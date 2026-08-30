import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPrivatePage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let mockSearchParams = new URLSearchParams({ slot: 'sched-1' });

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Pat',
  lastName: 'Parent',
  email: 'pat@example.com',
};

const STUDENT = { _id: 'student-1', firstName: 'Sam', lastName: 'Kid' };

const COACH_WITH_SLOTS = {
  coachId: 'coach-1',
  coachName: 'Dana Cole',
  slots: [
    {
      scheduleId: 'sched-1',
      dayOfWeek: 2,
      dayName: 'Tuesday',
      // Raw "HH:mm" — no displayTime field (see PublicPrivateClassSlot's
      // own comment). The page formats it; this fixture matches the real
      // wire shape.
      startTime: '16:00',
      durationMinutes: 60,
      sessionPrice: 65,
      hourlyRate: 65,
      firstSessionDate: '2026-09-01T16:00:00.000Z',
    },
  ],
};

const PAYMENT_METHOD = { _id: 'pm-1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 1, cardExpYear: 2030 };

let postPayload: unknown = null;
let enrollStatus = 201;
let enrollMessage = 'Failed';

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/private-class-schedules/public', () => HttpResponse.json({ coaches: [COACH_WITH_SLOTS] })),
  http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: PAYMENT_METHOD })),
  http.post('*/private-class-enrollments', async ({ request }) => {
    postPayload = await request.json();
    if (enrollStatus !== 201) {
      return HttpResponse.json({ message: enrollMessage }, { status: enrollStatus });
    }
    return HttpResponse.json(
      {
        enrollment: { _id: 'penroll-1', agreedHourlyRate: 65, status: 'active' },
        schedule: { _id: 'sched-1' },
        sessionPrice: 65,
        firstSessionDate: '2026-09-01T16:00:00.000Z',
      },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  postPayload = null;
  enrollStatus = 201;
  enrollMessage = 'Failed';
  mockSearchParams = new URLSearchParams({ slot: 'sched-1' });
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <ParentPortalProvider>
        <RegisterPrivatePage />
      </ParentPortalProvider>
    </AuthProvider>
  );
}

describe('RegisterPrivatePage', () => {
  it('walks through Who -> Review & Pay -> Done and posts the correct payload', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/who is this for/i);
    // Named regression: this had no coverage at all before, on either the
    // step-0 line or the summary rail — both used to render the slot's raw
    // "16:00" (a real bug shipped to parents, see PublicPrivateClassSlot's
    // own comment). Both must read 4:00 PM now.
    expect(await screen.findByText(/dana cole — tuesday 4:00 pm/i)).toBeInTheDocument();
    expect(screen.getByText(/tuesday · 4:00 pm · 60 min/i)).toBeInTheDocument();
    expect(screen.queryByText(/16:00/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /sam kid/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('heading', { name: /review & pay/i })).toBeInTheDocument();
    expect(screen.getByText(/charged/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm booking/i }));

    await waitFor(() => expect(postPayload).toEqual({ studentId: 'student-1', scheduleId: 'sched-1' }));
    expect(await screen.findByText(/you're booked/i)).toBeInTheDocument();
  });

  it('disables the CTA and shows a guard notice when there is no saved payment method', async () => {
    server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/who is this for/i);
    await user.click(screen.getByRole('radio', { name: /sam kid/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/add a payment method before registering/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeDisabled();
  });

  it('renders the backend 409 slot-taken message without crashing and offers a refresh action', async () => {
    enrollStatus = 409;
    enrollMessage = 'This time slot was just taken — please pick another';

    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/who is this for/i);
    await user.click(screen.getByRole('radio', { name: /sam kid/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /confirm booking/i }));

    expect(await screen.findByText(/just taken/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh available slots/i })).toBeInTheDocument();
  });
});
