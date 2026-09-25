import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  createCoachContract,
  deactivateCoachContract,
  fetchCoachContracts,
  fetchContractPreview,
  reviseCoachContract,
} from '../coachContracts';
import type { CoachContract, ContractPreview } from '../../types';

// The query-throws / mutation-never-throws contract (docs/TESTING_STRATEGY.md)
// for every coach-contract client function (docs/plans/coach-pack-pricing-plan.md §8).

const CONTRACT: CoachContract = {
  _id: 'contract-1',
  coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
  studentBillingRate: 65,
  coachCompensationRate: 40,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-08-01T12:00:00.000Z',
  isActive: true,
  privateLessonPacks: [{ _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 }],
};

const NEXT: CoachContract = { ...CONTRACT, _id: 'contract-2', studentBillingRate: 70 };
const ENDED: CoachContract = {
  ...CONTRACT,
  isActive: false,
  effectiveTo: '2026-09-25T12:00:00.000Z',
  endReason: 'revised',
};

const PREVIEW: ContractPreview = {
  sessionPrices: [{ durationMinutes: 60, price: 65 }],
  packs: [
    {
      sessionDurationMinutes: 30,
      quantity: 10,
      price: 300,
      perLessonPrice: 30,
      subtotal: 325,
      savings: 25,
      savingsPercent: 8,
      allowedRange: { min: 162.5, max: 324.99 },
      error: null,
    },
  ],
};

let lastBody: unknown = null;

const server = setupServer(
  http.get('*/coach-contracts', () => HttpResponse.json({ contracts: [CONTRACT] })),
  http.post('*/coach-contracts/preview', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json(PREVIEW);
  }),
  http.post('*/coach-contracts', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ contract: CONTRACT }, { status: 201 });
  }),
  http.post('*/coach-contracts/:id/revisions', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ contract: NEXT, previous: ENDED }, { status: 201 });
  }),
  http.post('*/coach-contracts/:id/deactivate', () => HttpResponse.json({ contract: { ...CONTRACT, isActive: false } }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  lastBody = null;
});
afterAll(() => server.close());

describe('coachContracts service — query contract (throws on failure)', () => {
  it('fetchCoachContracts resolves with the typed list', async () => {
    await expect(fetchCoachContracts()).resolves.toEqual([CONTRACT]);
  });

  it('fetchCoachContracts rejects on a server error', async () => {
    server.use(http.get('*/coach-contracts', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    await expect(fetchCoachContracts()).rejects.toBeTruthy();
  });

  it('fetchContractPreview posts the terms and resolves with lesson prices and pack quotes', async () => {
    const body = {
      studentBillingRate: 65,
      sessionDurationMinutes: 60,
      packs: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
      coachId: 'coach-1',
    };

    await expect(fetchContractPreview(body)).resolves.toEqual(PREVIEW);
    expect(lastBody).toEqual(body);
  });

  it('fetchContractPreview rejects on a server error (the editor then shows "Preview unavailable")', async () => {
    server.use(http.post('*/coach-contracts/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    await expect(fetchContractPreview({ studentBillingRate: 65, sessionDurationMinutes: 60, packs: [] })).rejects.toBeTruthy();
  });
});

describe('coachContracts service — mutation contract (never throws)', () => {
  it('createCoachContract sends the packs and resolves to success', async () => {
    const result = await createCoachContract({
      coachId: 'coach-1',
      studentBillingRate: 65,
      coachCompensationRate: 40,
      privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
    });

    expect(result).toEqual({ status: 'success', data: CONTRACT });
    expect(lastBody).toMatchObject({ privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }] });
  });

  it('createCoachContract resolves to the backend 409 message without throwing', async () => {
    server.use(
      http.post('*/coach-contracts', () =>
        HttpResponse.json({ message: 'This coach already has a contract — edit it instead' }, { status: 409 })
      )
    );

    await expect(
      createCoachContract({ coachId: 'coach-1', studentBillingRate: 65, coachCompensationRate: 40 })
    ).resolves.toEqual({ status: 'error', message: 'This coach already has a contract — edit it instead' });
  });

  it('reviseCoachContract sends the edited terms and resolves to the new and previous versions', async () => {
    const terms = {
      studentBillingRate: 70,
      coachCompensationRate: 40,
      sessionDurationMinutes: 60,
      privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
    };

    await expect(reviseCoachContract('contract-1', terms)).resolves.toEqual({
      status: 'success',
      data: { contract: NEXT, previous: ENDED },
    });
    expect(lastBody).toEqual(terms);
  });

  it('reviseCoachContract resolves to the backend 400 message without throwing', async () => {
    server.use(
      http.post('*/coach-contracts/:id/revisions', () => HttpResponse.json({ message: 'Nothing changed' }, { status: 400 }))
    );

    await expect(
      reviseCoachContract('contract-1', { studentBillingRate: 65, coachCompensationRate: 40 })
    ).resolves.toEqual({ status: 'error', message: 'Nothing changed' });
  });

  it('deactivateCoachContract resolves to an error object on a 404, without throwing', async () => {
    server.use(
      http.post('*/coach-contracts/:id/deactivate', () =>
        HttpResponse.json({ message: 'Coach contract not found' }, { status: 404 })
      )
    );

    await expect(deactivateCoachContract('missing')).resolves.toEqual({
      status: 'error',
      message: 'Coach contract not found',
    });
  });
});
