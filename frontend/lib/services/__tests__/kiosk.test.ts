import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { fetchKioskState, kioskSignIn } from '../kiosk';
import type { KioskSignInResult, KioskState } from '../../types';

// docs/plans/kiosk-signin-plan.md §5.2 and docs/TESTING_STRATEGY.md's
// error-handling contract: the query throws, the mutation never does.

const STATE: KioskState = {
  students: [{ studentId: 'stu-1', firstName: 'Ava', lastName: 'Student', levelName: 'Foundation' }],
  confirmationRequired: true,
  serverTime: '2026-09-30T15:00:00.000Z',
};

const SIGNED_IN: KioskSignInResult = {
  student: { _id: 'stu-1', firstName: 'Ava', lastName: 'Student' },
  session: { _id: 'sess-1', className: 'Foundation Foil', startTime: '16:00', endTime: '17:00', coachName: 'Cora Coach' },
  alreadySignedIn: false,
};

let signInBody: unknown = null;

const server = setupServer(
  http.get('*/kiosk/state', () => HttpResponse.json(STATE)),
  http.post('*/kiosk/sign-in', async ({ request }) => {
    signInBody = await request.json();
    return HttpResponse.json(SIGNED_IN);
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  signInBody = null;
});
afterAll(() => server.close());

describe('kiosk service', () => {
  it('fetchKioskState resolves the server response verbatim', async () => {
    await expect(fetchKioskState()).resolves.toEqual(STATE);
  });

  it('fetchKioskState rejects on failure (a query throws)', async () => {
    server.use(http.get('*/kiosk/state', () => HttpResponse.json({ message: 'no' }, { status: 401 })));

    await expect(fetchKioskState()).rejects.toBeTruthy();
  });

  it('kioskSignIn sends only the student id and resolves success with the server response', async () => {
    const result = await kioskSignIn('stu-1');

    expect(signInBody).toEqual({ studentId: 'stu-1' });
    expect(result).toEqual({ status: 'success', data: SIGNED_IN });
  });

  it("kioskSignIn resolves an error with the backend's message, never throwing", async () => {
    server.use(
      http.post('*/kiosk/sign-in', () => HttpResponse.json({ message: 'Ava has no class today' }, { status: 409 }))
    );

    await expect(kioskSignIn('stu-1')).resolves.toEqual({ status: 'error', message: 'Ava has no class today' });
  });

  it('kioskSignIn falls back to a generic message when the backend sends none', async () => {
    server.use(http.post('*/kiosk/sign-in', () => HttpResponse.error()));

    await expect(kioskSignIn('stu-1')).resolves.toEqual({
      status: 'error',
      message: 'Could not sign in. Please ask the front desk.',
    });
  });
});
