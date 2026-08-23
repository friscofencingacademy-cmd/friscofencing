import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import BookTrialPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil' };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee' };

const SCHEDULE_A = { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] };
const SCHEDULE_B = { _id: 'sched-2', classId: 'class-2', coachId: 'coach-1', dayOfWeek: 4, startTime: '18:00', endTime: '19:00', students: [] };

const FUTURE_SESSION = { _id: 'session-future', scheduleId: 'sched-1', date: '2099-01-01T00:00:00.000Z', students: [] };
const PAST_SESSION = { _id: 'session-past', scheduleId: 'sched-1', date: '2000-01-01T00:00:00.000Z', students: [] };

let postPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B] })),
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
  postPayload = null;
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderBookTrialPage() {
  return render(
    <ParentPortalProvider>
      <BookTrialPage />
    </ParentPortalProvider>
  );
}

describe('BookTrialPage wizard', () => {
  it('walks Who -> Pick a Class -> Confirmation and submits { studentId, sessionId }', async () => {
    renderBookTrialPage();

    // Step 0: Who
    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    fireEvent.click(childCard);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 1: Pick a Class
    await screen.findByLabelText('Class');
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /wednesday 4:00 pm-5:00 pm/i })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: SCHEDULE_A._id } });

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
      expect(postPayload).toEqual({ studentId: STUDENT._id, sessionId: FUTURE_SESSION._id });
    });

    // Step 2: Confirmation
    expect(await screen.findByText('Trial class booked!')).toBeInTheDocument();
    expect(screen.getByText('Kid One')).toBeInTheDocument();
  });

  it('preselects the child from the ?child= deep link', async () => {
    mockSearchParams = new URLSearchParams({ child: STUDENT._id });

    renderBookTrialPage();

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('back-navigation from step 1 to step 0 preserves the selected child', async () => {
    renderBookTrialPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Class');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an inline error on a booking failure without crashing, and stays on the same step', async () => {
    renderBookTrialPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Class');
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /wednesday 4:00 pm-5:00 pm/i })).toBeInTheDocument();
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
        HttpResponse.json({ message: 'This student has already used their trial class' }, { status: 409 })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /book trial class/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This student has already used their trial class');
    });

    // Still on step 1 — the class select is still visible.
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
  });
});

describe('BookTrialPage wizard — same-day session regression (bug fix)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("includes a session dated at today's midnight in the session dropdown", async () => {
    // Freeze "now" to 3pm on today's calendar date. A session stored at
    // today's midnight is always earlier than the current instant, so the
    // old `new Date(session.date).getTime() > now` comparison excluded it —
    // making same-day trial booking impossible even though the class hadn't
    // started yet. The fix compares against the start of today instead.
    const fixedNow = new Date();
    fixedNow.setHours(15, 0, 0, 0);

    jest.useFakeTimers({
      now: fixedNow,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'requestIdleCallback',
        'setImmediate',
        'setInterval',
        'setTimeout',
        'cancelAnimationFrame',
        'cancelIdleCallback',
        'clearImmediate',
        'clearInterval',
        'clearTimeout',
      ],
    });

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const TODAY_SESSION = { _id: 'session-today', scheduleId: 'sched-1', date: todayMidnight.toISOString(), students: [] };

    server.use(
      http.get('*/group-class-sessions/by-schedule/:scheduleId', () =>
        HttpResponse.json({ sessions: [TODAY_SESSION, PAST_SESSION] })
      )
    );

    renderBookTrialPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Class');
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: CLASS_A._id } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /wednesday 4:00 pm-5:00 pm/i })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: SCHEDULE_A._id } });

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: new Date(TODAY_SESSION.date).toLocaleDateString() })
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('option', { name: new Date(PAST_SESSION.date).toLocaleDateString() })
    ).not.toBeInTheDocument();
  });
});
