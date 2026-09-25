import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminCoachContractsPage from '../page';
import type { CoachContract, PackQuoteRow, PrivateLessonPackDraft } from '../../../../lib/types';

const COACH = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };
const NEW_COACH = { _id: 'coach-2', role: 'coach', firstName: 'Lee', lastName: 'Park', email: 'lee@example.com' };

const CONTRACT: CoachContract = {
  _id: 'contract-1',
  coachId: COACH,
  studentBillingRate: 65,
  coachCompensationRate: 40,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  isActive: true,
  // docs/plans/coach-pack-pricing-plan.md — the coach's own packs.
  privateLessonPacks: [{ _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 }],
};

const REFUSED = '10 × 30 min: price must be between $162.50 and $324.99';

let contracts: CoachContract[] = [CONTRACT];
let createdPayload: unknown = null;
let packsPayload: unknown = null;
let packsTargetId: string | null = null;
let deactivatedId: string | null = null;
let refuse = false;

// Preview figures come from here verbatim; the page never computes them.
function quoteFor(pack: PrivateLessonPackDraft): PackQuoteRow {
  return {
    sessionDurationMinutes: pack.sessionDurationMinutes,
    quantity: pack.quantity,
    price: pack.price,
    perLessonPrice: 30,
    subtotal: 325,
    savings: 25,
    savingsPercent: 8,
    allowedRange: { min: 162.5, max: 324.99 },
    error: refuse ? REFUSED : null,
  };
}

const server = setupServer(
  http.get('*/coach-contracts', () => HttpResponse.json({ contracts })),
  http.get('*/users', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('role') === 'coach') return HttpResponse.json({ users: [COACH, NEW_COACH] });
    return HttpResponse.json({ users: [] });
  }),
  http.post('*/coach-contracts/pack-quotes', async ({ request }) => {
    const body = (await request.json()) as { packs: PrivateLessonPackDraft[] };
    return HttpResponse.json({ quotes: body.packs.map(quoteFor) });
  }),
  http.post('*/coach-contracts', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json({ contract: { ...CONTRACT, _id: 'contract-2', studentBillingRate: 70 } }, { status: 201 });
  }),
  http.put('*/coach-contracts/:id/packs', async ({ params, request }) => {
    packsTargetId = params.id as string;
    packsPayload = await request.json();
    return HttpResponse.json({ contract: CONTRACT });
  }),
  http.post('*/coach-contracts/:id/deactivate', ({ params }) => {
    deactivatedId = params.id as string;
    return HttpResponse.json({ contract: { ...CONTRACT, isActive: false } });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  contracts = [CONTRACT];
  createdPayload = null;
  packsPayload = null;
  packsTargetId = null;
  deactivatedId = null;
  refuse = false;
});
afterAll(() => server.close());

describe('AdminCoachContractsPage', () => {
  it('renders the contracts table with rate/duration/packs/status', async () => {
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    expect(screen.getByText('$65.00')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
    expect(screen.getByText('10 × 30 min — $300.00')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('creates a new contract with the exact payload, including packs prefilled from the coach’s current contract (plan D9)', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /add contract/i }));

    const dialog = await screen.findByRole('dialog', { name: /add contract/i });
    await user.selectOptions(within(dialog).getByLabelText(/^coach$/i), 'coach-1');
    await user.type(within(dialog).getByLabelText(/rate billed to parent/i), '70');
    await user.type(within(dialog).getByLabelText(/coach compensation/i), '45');

    // The current contract's pack is prefilled, and previewed by the backend.
    expect(within(dialog).getByLabelText(/pack 1 price/i)).toHaveValue(300);
    expect(await within(dialog).findByText('$30.00 per lesson · saves $25.00 (8%)')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^create$/i }));

    // The pack is sent as a NEW pack — no _id (a new contract's packs are new).
    await waitFor(() =>
      expect(createdPayload).toEqual({
        coachId: 'coach-1',
        studentBillingRate: 70,
        coachCompensationRate: 45,
        sessionDurationMinutes: 60,
        privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
      })
    );
  });

  it('creates a contract with no packs for a coach who has none', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /add contract/i }));
    const dialog = await screen.findByRole('dialog', { name: /add contract/i });
    await user.selectOptions(within(dialog).getByLabelText(/^coach$/i), 'coach-2');
    await user.type(within(dialog).getByLabelText(/rate billed to parent/i), '60');
    await user.type(within(dialog).getByLabelText(/coach compensation/i), '35');

    await user.click(within(dialog).getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createdPayload).toEqual({
        coachId: 'coach-2',
        studentBillingRate: 60,
        coachCompensationRate: 35,
        sessionDurationMinutes: 60,
        privateLessonPacks: [],
      })
    );
  });

  it('edits packs on the active contract: sends kept ids back, shows the preview, and closes on success', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /edit packs for dana cole/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit packs/i });
    expect(await within(dialog).findByText('$30.00 per lesson · saves $25.00 (8%)')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /add pack/i }));
    await user.clear(within(dialog).getByLabelText(/pack 2 lesson length/i));
    await user.type(within(dialog).getByLabelText(/pack 2 lesson length/i), '30');
    await user.type(within(dialog).getByLabelText(/pack 2 sessions/i), '5');
    await user.type(within(dialog).getByLabelText(/pack 2 price/i), '155');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /save packs/i })).toBeEnabled());

    await user.click(within(dialog).getByRole('button', { name: /save packs/i }));

    await waitFor(() =>
      expect(packsPayload).toEqual({
        privateLessonPacks: [
          { _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 },
          { sessionDurationMinutes: 30, quantity: 5, price: 155 },
        ],
      })
    );
    expect(packsTargetId).toBe('contract-1');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit packs/i })).not.toBeInTheDocument());
  });

  it("disables Save while the backend's preview refuses a pack", async () => {
    refuse = true;
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /edit packs for dana cole/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit packs/i });
    expect(await within(dialog).findByText(REFUSED)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /save packs/i })).toBeDisabled();
  });

  it("shows the backend's 400 on save inline without crashing, and keeps the dialog open", async () => {
    server.use(
      http.put('*/coach-contracts/:id/packs', () => HttpResponse.json({ message: REFUSED }, { status: 400 }))
    );
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /edit packs for dana cole/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit packs/i });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /save packs/i })).toBeEnabled());

    await user.click(within(dialog).getByRole('button', { name: /save packs/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.getByRole('dialog', { name: /edit packs/i })).toBeInTheDocument();
  });

  it('deactivates a contract via the confirm dialog', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /^deactivate$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will no longer be able to publish/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(deactivatedId).toBe('contract-1'));
  });

  // orphaned-coach-reference-fix-plan D2/D3 — a contract whose coach was
  // deleted must render a fallback label, not crash.
  it("renders a fallback label when the contract's coach was deleted", async () => {
    contracts = [{ ...CONTRACT, _id: 'contract-orphan', coachId: null }];
    render(<AdminCoachContractsPage />);

    await screen.findByText('Coach no longer available');
  });
});
