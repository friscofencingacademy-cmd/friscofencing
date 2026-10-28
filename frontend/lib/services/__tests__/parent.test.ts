import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../test-utils/msw';

import { cancelTrialClass, fetchRegistrationPricePreview, rescheduleTrialClass } from '../parent';
import type { TrialClass } from '../../types';

const PREVIEW = { monthlyFee: 150, chargeAmount: 135, siblingDiscountApplied: true, siblingDiscountAmount: 15 };

const server = setupServer(
  http.get('*/registrations/preview', () => HttpResponse.json(PREVIEW))
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('parent service — query contract (throws on failure)', () => {
  it('fetchRegistrationPricePreview resolves with the typed preview on success', async () => {
    await expect(
      fetchRegistrationPricePreview({ studentId: 'student-1', scheduleId: 'sched-1', startDate: '2099-01-06T00:00:00.000Z' })
    ).resolves.toEqual(PREVIEW);
  });

  it('fetchRegistrationPricePreview throws (rejects) on a server error', async () => {
    server.use(
      http.get('*/registrations/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );

    await expect(
      fetchRegistrationPricePreview({ studentId: 'student-1', scheduleId: 'sched-1', startDate: '2099-01-06T00:00:00.000Z' })
    ).rejects.toBeTruthy();
  });
});

// docs/plans/trial-cancel-reschedule-plan.md
describe('parent service — trial mutations never throw', () => {
  const MOVED: TrialClass = {
    _id: 'trial-1',
    studentId: { _id: 'student-1', firstName: 'Kid', lastName: 'One' },
    sessionId: { _id: 'session-2', date: '2099-01-08T00:00:00.000Z' },
  };

  it('rescheduleTrialClass PATCHes the trial with { sessionId } and resolves with the moved trial', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/trial-classes/trial-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ trialClass: MOVED });
      })
    );

    await expect(rescheduleTrialClass('trial-1', { sessionId: 'session-2' })).resolves.toEqual({
      status: 'success',
      data: MOVED,
    });
    expect(body).toEqual({ sessionId: 'session-2' });
  });

  it("rescheduleTrialClass resolves with the server's message on a refusal", async () => {
    server.use(
      http.patch('*/trial-classes/trial-1', () =>
        HttpResponse.json({ message: 'This session falls on an academy holiday' }, { status: 400 })
      )
    );

    await expect(rescheduleTrialClass('trial-1', { sessionId: 'session-2' })).resolves.toEqual({
      status: 'error',
      message: 'This session falls on an academy holiday',
    });
  });

  it('cancelTrialClass DELETEs the trial and resolves success', async () => {
    server.use(http.delete('*/trial-classes/trial-1', () => HttpResponse.json({ success: true })));

    await expect(cancelTrialClass('trial-1')).resolves.toEqual({ status: 'success', data: undefined });
  });

  it("cancelTrialClass resolves with the server's message on a refusal", async () => {
    server.use(
      http.delete('*/trial-classes/trial-1', () =>
        HttpResponse.json(
          { message: 'Attendance has already been taken for this trial class — it can no longer be changed' },
          { status: 409 }
        )
      )
    );

    await expect(cancelTrialClass('trial-1')).resolves.toEqual({
      status: 'error',
      message: 'Attendance has already been taken for this trial class — it can no longer be changed',
    });
  });
});
