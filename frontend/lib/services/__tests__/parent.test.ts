import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { fetchRegistrationPricePreview } from '../parent';

const PREVIEW = { monthlyFee: 150, chargeAmount: 135, siblingDiscountApplied: true, siblingDiscountAmount: 15 };

const server = setupServer(
  http.get('*/registrations/preview', () => HttpResponse.json(PREVIEW))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('parent service — query contract (throws on failure)', () => {
  it('fetchRegistrationPricePreview resolves with the typed preview on success', async () => {
    await expect(
      fetchRegistrationPricePreview({ studentId: 'student-1', scheduleId: 'sched-1' })
    ).resolves.toEqual(PREVIEW);
  });

  it('fetchRegistrationPricePreview throws (rejects) on a server error', async () => {
    server.use(
      http.get('*/registrations/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );

    await expect(
      fetchRegistrationPricePreview({ studentId: 'student-1', scheduleId: 'sched-1' })
    ).rejects.toBeTruthy();
  });
});
