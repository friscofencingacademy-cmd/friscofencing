import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AttendancePage from '../page';
import { AuthProvider } from '../../../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ id: 'session-1' }),
}));

const COACH_USER = {
  _id: 'coach-1',
  role: 'coach',
  firstName: 'Coach',
  lastName: 'Test',
  email: 'coach@example.com',
};

const SESSION = {
  _id: 'session-1',
  date: '2026-03-04T00:00:00.000Z',
  students: [
    { studentId: { _id: 'student-1', firstName: 'Ada', lastName: 'One' }, isPresent: true },
    { studentId: { _id: 'student-2', firstName: 'Ben', lastName: 'Two' }, isPresent: false },
  ],
};

let patchedPayload: unknown = null;

// Wildcard host pattern, matching the network-boundary MSW convention
// established in app/login/__tests__/page.test.tsx.
const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: COACH_USER })),
  http.get('*/group-class-sessions/session-1', () => HttpResponse.json({ session: SESSION })),
  http.patch('*/group-class-sessions/session-1/attendance', async ({ request }) => {
    patchedPayload = await request.json();
    return HttpResponse.json({ session: SESSION });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  patchedPayload = null;
});
afterAll(() => server.close());

function renderAttendancePage() {
  return render(
    <AuthProvider>
      <AttendancePage />
    </AuthProvider>
  );
}

describe('AttendancePage', () => {
  it('renders the roster pre-checked from isPresent and saves the toggled state', async () => {
    renderAttendancePage();

    await screen.findByText('Ada One');

    const adaCheckbox = screen.getByRole('checkbox', { name: /ada one/i });
    const benCheckbox = screen.getByRole('checkbox', { name: /ben two/i });

    expect(adaCheckbox).toBeChecked();
    expect(benCheckbox).not.toBeChecked();

    fireEvent.click(benCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /save attendance/i }));

    await waitFor(() => {
      expect(patchedPayload).toEqual({
        students: [
          { studentId: 'student-1', isPresent: true },
          { studentId: 'student-2', isPresent: true },
        ],
      });
    });

    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
  });

  it('shows the error message on a 403 response without crashing', async () => {
    server.use(
      http.patch('*/group-class-sessions/session-1/attendance', () =>
        HttpResponse.json(
          { message: 'You are not the assigned coach for this session' },
          { status: 403 }
        )
      )
    );

    renderAttendancePage();

    await screen.findByText('Ada One');

    fireEvent.click(screen.getByRole('button', { name: /save attendance/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You are not the assigned coach for this session'
      );
    });
  });
});
