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
    { studentId: { _id: 'student-1', firstName: 'Ada', lastName: 'One' }, isPresent: true, classType: 'regular' },
    { studentId: { _id: 'student-2', firstName: 'Ben', lastName: 'Two' }, isPresent: false, classType: 'regular' },
    { studentId: { _id: 'student-3', firstName: 'Cami', lastName: 'Trial' }, isPresent: true, classType: 'trial' },
  ],
};

const LEVELS = [{ _id: 'level-1', name: 'Beginner Above 10Y', order: 1 }];

let patchedPayload: unknown = null;
let evaluationPayload: unknown = null;

// Wildcard host pattern, matching the network-boundary MSW convention
// established in app/login/__tests__/page.test.tsx.
const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: COACH_USER })),
  http.get('*/group-class-sessions/session-1', () => HttpResponse.json({ session: SESSION })),
  http.get('*/levels', () => HttpResponse.json({ levels: LEVELS })),
  http.patch('*/group-class-sessions/session-1/attendance', async ({ request }) => {
    patchedPayload = await request.json();
    return HttpResponse.json({ session: SESSION });
  }),
  http.post('*/evaluations', async ({ request }) => {
    evaluationPayload = await request.json();
    return HttpResponse.json({
      evaluation: {
        _id: 'eval-1',
        studentId: SESSION.students[2].studentId,
        coachId: COACH_USER,
        groupClassSessionId: { _id: 'session-1', date: SESSION.date, scheduleId: 'schedule-1' },
        assignedLevelId: LEVELS[0],
        notes: 'Great trial.',
      },
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  patchedPayload = null;
  evaluationPayload = null;
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
          { studentId: 'student-3', isPresent: true },
        ],
      });
    });

    expect(await screen.findByText('Attendance saved.')).toBeInTheDocument();
  });

  // docs/plans/holiday-blocking-plan.md D6/§2.5 — a holiday-date session
  // renders a blocked alert with no checkbox list or Save button. The
  // backend's own markAttendance 400 (D7) is the real guarantee; this is
  // display-only.
  describe('holiday-date session (docs/plans/holiday-blocking-plan.md)', () => {
    it('renders a blocked alert instead of the roster, with no Save Attendance button', async () => {
      server.use(
        http.get('*/group-class-sessions/session-1', () =>
          HttpResponse.json({ session: { ...SESSION, isHoliday: true, holidayName: 'Winter Break' } })
        )
      );

      renderAttendancePage();

      expect(await screen.findByText(/winter break/i)).toBeInTheDocument();
      expect(screen.getByText(/attendance is disabled/i)).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save attendance/i })).not.toBeInTheDocument();
    });
  });

  it('offers Evaluate only for a trial student already marked present, and submits the evaluation', async () => {
    renderAttendancePage();

    await screen.findByText('Ada One');

    // Regular students, present or not, never get an Evaluate action — only
    // the one trial+present row (Cami) does.
    const evaluateButtons = screen.getAllByRole('button', { name: /evaluate/i });
    expect(evaluateButtons).toHaveLength(1);

    fireEvent.click(evaluateButtons[0]);

    fireEvent.change(screen.getByRole('combobox', { name: /recommended level/i }), {
      target: { value: 'level-1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /evaluation notes/i }), {
      target: { value: 'Great trial.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save evaluation/i }));

    await waitFor(() => {
      expect(evaluationPayload).toEqual({
        studentId: 'student-3',
        groupClassSessionId: 'session-1',
        assignedLevelId: 'level-1',
        notes: 'Great trial.',
      });
    });

    expect(await screen.findByText('Evaluated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /evaluate/i })).not.toBeInTheDocument();
  });

  it('shows an inline error on a failed evaluation submit without crashing', async () => {
    server.use(
      http.post('*/evaluations', () =>
        HttpResponse.json({ message: 'An evaluation already exists for this student and session' }, { status: 409 })
      )
    );

    renderAttendancePage();

    await screen.findByText('Ada One');
    fireEvent.click(screen.getByRole('button', { name: /evaluate/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /recommended level/i }), {
      target: { value: 'level-1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /evaluation notes/i }), {
      target: { value: 'Notes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save evaluation/i }));

    expect(await screen.findByText('An evaluation already exists for this student and session')).toBeInTheDocument();
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
