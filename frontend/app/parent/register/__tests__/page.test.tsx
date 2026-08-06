import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Par',
  lastName: 'Ent',
  email: 'parent@example.com',
};

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

const LEVEL_BEGINNER = { _id: 'level-1', name: 'Beginner' };
const LEVEL_ADVANCED = { _id: 'level-2', name: 'Advanced' };

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil', levelId: LEVEL_BEGINNER._id };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee', levelId: LEVEL_ADVANCED._id };

// Two schedules, only one (sched-1) belongs to CLASS_A — used to confirm
// client-side filtering by classId.
const SCHEDULE_A = { _id: 'sched-1', classId: 'class-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' };
const SCHEDULE_B = { _id: 'sched-2', classId: 'class-2', dayOfWeek: 4, startTime: '18:00', endTime: '19:00' };

const PRICE_BEGINNER = { _id: 'price-1', levelId: LEVEL_BEGINNER._id, monthlyFee: 150 };

const SAVED_PAYMENT_METHOD = {
  _id: 'pm-1',
  cardBrand: 'visa',
  cardLast4: '4242',
  cardExpMonth: 8,
  cardExpYear: 2030,
};

let postPayload: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-schedules', () =>
    HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B] })
  ),
  http.get('*/prices', () => HttpResponse.json({ prices: [PRICE_BEGINNER] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [LEVEL_BEGINNER, LEVEL_ADVANCED] })),
  http.get('*/payment-methods/mine', () =>
    HttpResponse.json({ paymentMethod: SAVED_PAYMENT_METHOD })
  ),
  http.post('*/registrations', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json(
      {
        registration: { _id: 'reg-1' },
        subscription: { _id: 'sub-1' },
        chargeAmount: 150,
        paymentIntentStatus: 'succeeded',
      },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  postPayload = null;
});
afterAll(() => server.close());

function renderRegisterPage() {
  return render(
    <AuthProvider>
      <RegisterPage />
    </AuthProvider>
  );
}

async function selectClassAndSchedule() {
  fireEvent.change(screen.getByLabelText('Child'), { target: { value: STUDENT._id } });
  fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });

  // Only the schedule belonging to CLASS_A should be selectable.
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Wednesday 16:00-17:00/ })).toBeInTheDocument();
  });
  expect(screen.queryByRole('option', { name: /Thursday 18:00-19:00/ })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: SCHEDULE_A._id } });
}

describe('RegisterPage', () => {
  it('walks the cascading selects, shows the resolved price, and submits { studentId, scheduleId }', async () => {
    renderRegisterPage();

    await screen.findByLabelText('Child');

    await selectClassAndSchedule();

    // Price for CLASS_A's level (Beginner) resolved via /prices + /levels.
    await waitFor(() => {
      expect(screen.getByText(/Level: Beginner — \$150\/month/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({
        studentId: STUDENT._id,
        scheduleId: SCHEDULE_A._id,
      });
    });

    expect(await screen.findByText(/registration complete.*\$150\.00/i)).toBeInTheDocument();
  });

  it('shows a message with a link to /parent/payment-method instead of a submit form when no payment method is saved', async () => {
    server.use(
      http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null }))
    );

    renderRegisterPage();

    expect(
      await screen.findByText(/you'll need to add a payment method before registering/i)
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /here/i });
    expect(link).toHaveAttribute('href', '/parent/payment-method');

    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Child')).not.toBeInTheDocument();
  });

  it('shows an inline error when the student is already registered for the schedule (409), without crashing', async () => {
    renderRegisterPage();

    await screen.findByLabelText('Child');
    await selectClassAndSchedule();

    await waitFor(() => {
      expect(screen.getByText(/Level: Beginner — \$150\/month/)).toBeInTheDocument();
    });

    server.use(
      http.post('*/registrations', () =>
        HttpResponse.json(
          { message: 'This student is already registered for this schedule' },
          { status: 409 }
        )
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This student is already registered for this schedule'
      );
    });
  });
});
