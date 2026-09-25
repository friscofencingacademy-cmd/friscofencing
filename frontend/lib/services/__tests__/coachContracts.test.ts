import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  createCoachContract,
  deactivateCoachContract,
  fetchCoachContracts,
  fetchPackQuotes,
  updateCoachContractPacks,
} from '../coachContracts';
import type { CoachContract, PackQuoteRow } from '../../types';

// The query-throws / mutation-never-throws contract (docs/TESTING_STRATEGY.md)
// for every coach-contract client function, including the pack functions
// added by docs/plans/coach-pack-pricing-plan.md.

const CONTRACT: CoachContract = {
  _id: 'contract-1',
  coachId: { _id: 'coach-1', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' },
  studentBillingRate: 65,
  coachCompensationRate: 40,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  isActive: true,
  privateLessonPacks: [{ _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 }],
};

const QUOTE: PackQuoteRow = {
  sessionDurationMinutes: 30,
  quantity: 10,
  price: 300,
  perLessonPrice: 30,
  subtotal: 325,
  savings: 25,
  savingsPercent: 8,
  allowedRange: { min: 162.5, max: 324.99 },
  error: null,
};

const REFUSED = '10 × 30 min: price must be between $162.50 and $324.99';

let lastBody: unknown = null;

const server = setupServer(
  http.get('*/coach-contracts', () => HttpResponse.json({ contracts: [CONTRACT] })),
  http.post('*/coach-contracts/pack-quotes', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ quotes: [QUOTE] });
  }),
  http.post('*/coach-contracts', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ contract: CONTRACT }, { status: 201 });
  }),
  http.put('*/coach-contracts/:id/packs', async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ contract: CONTRACT });
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

  it('fetchPackQuotes posts the rate and packs, and resolves with the quotes', async () => {
    const packs = [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }];

    await expect(fetchPackQuotes({ studentBillingRate: 65, packs })).resolves.toEqual([QUOTE]);
    expect(lastBody).toEqual({ studentBillingRate: 65, packs });
  });

  it('fetchPackQuotes rejects on a server error (the editor then shows "Preview unavailable")', async () => {
    server.use(
      http.post('*/coach-contracts/pack-quotes', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );

    await expect(fetchPackQuotes({ studentBillingRate: 65, packs: [] })).rejects.toBeTruthy();
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

  it('createCoachContract resolves to the backend 400 message without throwing', async () => {
    server.use(http.post('*/coach-contracts', () => HttpResponse.json({ message: REFUSED }, { status: 400 })));

    await expect(
      createCoachContract({ coachId: 'coach-1', studentBillingRate: 65, coachCompensationRate: 40 })
    ).resolves.toEqual({ status: 'error', message: REFUSED });
  });

  it('updateCoachContractPacks sends { privateLessonPacks } and resolves to success', async () => {
    const packs = [{ _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 }];

    await expect(updateCoachContractPacks('contract-1', packs)).resolves.toEqual({ status: 'success', data: CONTRACT });
    expect(lastBody).toEqual({ privateLessonPacks: packs });
  });

  it('updateCoachContractPacks resolves to the backend 400 message without throwing', async () => {
    server.use(http.put('*/coach-contracts/:id/packs', () => HttpResponse.json({ message: REFUSED }, { status: 400 })));

    await expect(updateCoachContractPacks('contract-1', [])).resolves.toEqual({ status: 'error', message: REFUSED });
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
