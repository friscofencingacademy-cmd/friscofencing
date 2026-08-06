import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import BookTrialPage from '../page';
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

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil' };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee' };

// Two schedules, only one (sched-1) belongs to CLASS_A — used to confirm
// client-side filtering by classId.
const SCHEDULE_A = { _id: 'sched-1', classId: 'class-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00' };
const SCHEDULE_B = { _id: 'sched-2', classId: 'class-2', dayOfWeek: 4, startTime: '18:00', endTime: '19:00' };

const FUTURE_SESSION = { _id: 'session-future', date: '2099-01-01T00:00:00.000Z' };
const PAST_SESSION = { _id: 'session-past', date: '2000-01-01T00:00:00.000Z' };

let postPayload: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-schedules', () =>
    HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B] })
  ),
  http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
    HttpResponse.json({ sessions: [FUTURE_SESSION, PAST_SESSION] })
  ),
  http.post('*/trial-classes', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json({ trialClass: { _id: 'trial-1' } }, { status: 201 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  postPayload = null;
});
afterAll(() => server.close());

function renderBookTrialPage() {
  return render(
    <AuthProvider>
      <BookTrialPage />
    </AuthProvider>
  );
}

describe('BookTrialPage', () => {
  it('walks the cascading selects and submits { studentId, sessionId }', async () => {
    renderBookTrialPage();

    await screen.findByLabelText('Child');

    fireEvent.change(screen.getByLabelText('Child'), { target: { value: STUDENT._id } });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });

    // Only the schedule belonging to CLASS_A should be selectable.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Wednesday 16:00-17:00/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /Thursday 18:00-19:00/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: SCHEDULE_A._id } });

    // Only the future session should be selectable; the past one is filtered out.
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: new Date(FUTURE_SESSION.date).toLocaleDateString() })
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('option', { name: new Date(PAST_SESSION.date).toLocaleDateString() })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Session'), { target: { value: FUTURE_SESSION._id } });

    fireEvent.click(screen.getByRole('button', { name: /book trial class/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({
        studentId: STUDENT._id,
        sessionId: FUTURE_SESSION._id,
      });
    });

    expect(await screen.findByText(/booked/i)).toBeInTheDocument();
  });

  it('shows an inline error on a booking failure (e.g. trial already used), without crashing', async () => {
    renderBookTrialPage();

    await screen.findByLabelText('Child');

    fireEvent.change(screen.getByLabelText('Child'), { target: { value: STUDENT._id } });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Wednesday 16:00-17:00/ })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: SCHEDULE_A._id } });

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: new Date(FUTURE_SESSION.date).toLocaleDateString() })
      ).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: FUTURE_SESSION._id } });

    server.use(
      http.post('*/trial-classes', () =>
        HttpResponse.json(
          { message: 'This student has already used their trial class' },
          { status: 409 }
        )
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /book trial class/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This student has already used their trial class'
      );
    });
  });
});
