import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import KioskPage from '../page';
import { AuthProvider } from '../../context/AuthContext';
import { POLL_INTERVAL_MS, SUCCESS_DISMISS_MS } from '../../../lib/kiosk';
import type { KioskSignInResult, KioskState } from '../../../lib/types';

// The front-desk sign-in tablet (docs/plans/kiosk-signin-plan.md K7). HTTP is
// mocked at the network boundary (MSW); only the Next.js router is mocked
// (docs/TESTING_STRATEGY.md's named exception). Timers stay real for every
// network wait — per this repo's own finding, fake timers + MSW's XHR stack
// hang Testing Library — and are faked only around the one timer under test.

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn() }),
}));

const KIOSK_USER = { _id: 'kiosk-1', role: 'kiosk', firstName: 'Front', lastName: 'Desk', email: 'frontdesk@example.com' };

const STATE: KioskState = {
  students: [
    { studentId: 'stu-ava', firstName: 'Ava', lastName: 'Anderson', levelName: 'Foundation' },
    { studentId: 'stu-bob', firstName: 'Bob', lastName: 'Avery', levelName: null },
    { studentId: 'stu-cal', firstName: 'Cal', lastName: 'Brown', levelName: 'Intermediate' },
  ],
  confirmationRequired: true,
  serverTime: '2026-09-30T20:00:00.000Z',
};

function signedIn(overrides: Partial<KioskSignInResult> = {}): KioskSignInResult {
  return {
    student: { _id: 'stu-ava', firstName: 'Ava', lastName: 'Anderson' },
    session: { _id: 'sess-1', className: 'Foundation Foil', startTime: '16:00', endTime: '17:00', coachName: 'Cora Coach' },
    alreadySignedIn: false,
    ...overrides,
  };
}

let state: KioskState = STATE;
let stateRequests = 0;
let signInBodies: unknown[] = [];

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: KIOSK_USER })),
  http.get('*/kiosk/state', () => {
    stateRequests += 1;
    return HttpResponse.json(state);
  }),
  http.post('*/kiosk/sign-in', async ({ request }) => {
    signInBodies.push(await request.json());
    return HttpResponse.json(signedIn());
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  state = STATE;
  stateRequests = 0;
  signInBodies = [];
  pushMock.mockReset();
  jest.useRealTimers();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <KioskPage />
    </AuthProvider>
  );
}

async function renderReady() {
  renderPage();
  return screen.findByTestId('roster-search');
}

function type(value: string) {
  fireEvent.change(screen.getByTestId('roster-search'), { target: { value } });
}

// Fakes ONLY the named timer functions; Date, promises, and the timers MSW and
// Testing Library rely on stay real.
function fakeOnly(...names: ('setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval')[]) {
  const all = [
    'Date',
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
  ] as const;
  jest.useFakeTimers({ doNotFake: all.filter((name) => !(names as string[]).includes(name)) });
}

describe('KioskPage — search', () => {
  it('shows no names until 2 characters are typed', async () => {
    await renderReady();

    expect(screen.getByText('Type your name to sign in.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('roster-row')).toHaveLength(0);

    type('a');
    expect(screen.queryAllByTestId('roster-row')).toHaveLength(0);
  });

  it('matches the start of a first OR last name, case-insensitively', async () => {
    await renderReady();

    type('AV');

    const rows = screen.getAllByTestId('roster-row').map((row) => row.textContent);
    expect(rows).toEqual(['Ava AndersonFoundation', 'Bob Avery']);
    expect(screen.queryByText(/Cal Brown/)).not.toBeInTheDocument();
  });

  it('says so when nothing matches, and when nobody is enrolled', async () => {
    await renderReady();
    type('zz');
    expect(screen.getByText('No matching names.')).toBeInTheDocument();
  });

  it('shows an empty-academy message when the list is empty', async () => {
    state = { ...STATE, students: [] };
    await renderReady();

    expect(screen.getByText('No students are enrolled yet.')).toBeInTheDocument();
  });
});

describe('KioskPage — signing in', () => {
  it('confirms, sends only the student id, shows the signed-in card, and a tap returns to search', async () => {
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));

    // Visible text, not the computed accessible name: the name algorithm pads
    // the <strong> with spaces ("Anderson ?") that are not on screen.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Are you Ava Anderson\?$/);
    fireEvent.click(screen.getByRole('button', { name: "Yes, that's me" }));

    expect(await screen.findByText('Ava Anderson signed in')).toBeInTheDocument();
    expect(screen.getByText('Foundation Foil · 4:00 PM–5:00 PM')).toBeInTheDocument();
    expect(signInBodies).toEqual([{ studentId: 'stu-ava' }]);

    fireEvent.click(screen.getByText('Ava Anderson signed in'));
    expect(screen.getByTestId('roster-search')).toHaveValue('');
  });

  it('"Not me" goes back to the search without signing in', async () => {
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));
    fireEvent.click(screen.getByRole('button', { name: 'Not me' }));

    expect(screen.getByTestId('roster-search')).toBeInTheDocument();
    expect(signInBodies).toEqual([]);
  });

  it('signs in on the first tap, with no confirm step, when the setting is off', async () => {
    state = { ...STATE, confirmationRequired: false };
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));

    expect(await screen.findByText('Ava Anderson signed in')).toBeInTheDocument();
    expect(screen.queryByText(/are you/i)).not.toBeInTheDocument();
    expect(signInBodies).toEqual([{ studentId: 'stu-ava' }]);
  });

  it('tells a student who already signed in today', async () => {
    server.use(http.post('*/kiosk/sign-in', () => HttpResponse.json(signedIn({ alreadySignedIn: true }))));
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));
    fireEvent.click(screen.getByRole('button', { name: "Yes, that's me" }));

    expect(await screen.findByText("Ava, you're already signed in for today.")).toBeInTheDocument();
  });

  it("shows the backend's message inline and keeps the search usable", async () => {
    server.use(
      http.post('*/kiosk/sign-in', () =>
        HttpResponse.json({ message: "Ava's class today has already ended" }, { status: 409 })
      )
    );
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));
    fireEvent.click(screen.getByRole('button', { name: "Yes, that's me" }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Ava's class today has already ended");

    type('cal');
    expect(screen.getByText('Cal Brown')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it(`returns to the search by itself ${SUCCESS_DISMISS_MS} ms after signing in`, async () => {
    await renderReady();
    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));

    fakeOnly('setTimeout', 'clearTimeout');
    fireEvent.click(screen.getByRole('button', { name: "Yes, that's me" }));
    expect(await screen.findByText('Ava Anderson signed in')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(SUCCESS_DISMISS_MS - 1);
    });
    expect(screen.getByText('Ava Anderson signed in')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    jest.useRealTimers();
    expect(screen.getByTestId('roster-search')).toHaveValue('');
  });
});

describe('KioskPage — staying current', () => {
  it(`refreshes every ${POLL_INTERVAL_MS} ms, picking up a switched-off confirmation`, async () => {
    fakeOnly('setInterval', 'clearInterval');
    await renderReady();
    const before = stateRequests;

    state = { ...STATE, confirmationRequired: false };
    act(() => {
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    jest.useRealTimers();
    await waitFor(() => expect(stateRequests).toBe(before + 1));

    type('ava');
    fireEvent.click(screen.getByText('Ava Anderson'));
    expect(await screen.findByText('Ava Anderson signed in')).toBeInTheDocument();
  });

  it('refreshes when the tablet wakes up', async () => {
    await renderReady();
    const before = stateRequests;

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(stateRequests).toBe(before + 1));
  });

  it('shows LoadError on a failed first load, and "Try again" recovers', async () => {
    server.use(http.get('*/kiosk/state', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(http.get('*/kiosk/state', () => HttpResponse.json(STATE)));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByTestId('roster-search')).toBeInTheDocument();
  });

  it('keeps the list it has when a background refresh fails', async () => {
    await renderReady();
    server.use(http.get('*/kiosk/state', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    const before = stateRequests;

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    type('ava');
    expect(screen.getByText('Ava Anderson')).toBeInTheDocument();
    expect(stateRequests).toBe(before);
  });

  it('sends the tablet to the login page when its login has expired', async () => {
    server.use(http.get('*/kiosk/state', () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })));
    renderPage();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login?next=/kiosk'));
  });
});

describe('KioskPage — who may open it', () => {
  it('sends a parent login away', async () => {
    server.use(
      http.get('*/auth/me', () =>
        HttpResponse.json({ user: { _id: 'p-1', role: 'parent', firstName: 'Pat', lastName: 'Parent' } })
      )
    );
    renderPage();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(screen.queryByTestId('roster-search')).not.toBeInTheDocument();
  });
});
