import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminCoachContractsPage from '../page';
import type { CoachContract, ContractPreview, PrivateLessonPackDraft } from '../../../../lib/types';

// docs/plans/coach-pack-pricing-plan.md §8 — contracts kept as versions: the
// current one has Edit and Deactivate, older ones are read-only history, and
// one dialog (Rates + Packs) serves Add and Edit.

const COACH = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };
const NEW_COACH = { _id: 'coach-2', role: 'coach', firstName: 'Lee', lastName: 'Park', email: 'lee@example.com' };

const CURRENT: CoachContract = {
  _id: 'contract-2',
  coachId: COACH,
  studentBillingRate: 65,
  coachCompensationRate: 40,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-09-01T12:00:00.000Z',
  isActive: true,
  privateLessonPacks: [{ _id: 'pack-2', sessionDurationMinutes: 30, quantity: 10, price: 300 }],
};

// The version CURRENT replaced — history, never editable.
const REPLACED: CoachContract = {
  _id: 'contract-1',
  coachId: COACH,
  studentBillingRate: 60,
  coachCompensationRate: 35,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-08-01T12:00:00.000Z',
  effectiveTo: '2026-09-01T12:00:00.000Z',
  endReason: 'revised',
  isActive: false,
  privateLessonPacks: [],
};

const REFUSED = '10 × 30 min: price must be between $162.50 and $324.99';

let contracts: CoachContract[] = [CURRENT, REPLACED];
let createdPayload: unknown = null;
let revisedPayload: unknown = null;
let revisedId: string | null = null;
let deactivatedId: string | null = null;
let refuse = false;

// Preview figures come from here verbatim — deliberately not what $65/hr
// would give (30 min would be $32.50), so a client-side calculation shows.
function previewFor(body: { packs: PrivateLessonPackDraft[] }): ContractPreview {
  return {
    sessionPrices: [
      { durationMinutes: 30, price: 31.11 },
      { durationMinutes: 60, price: 62.22 },
    ],
    packs: body.packs.map((pack) => ({
      ...pack,
      perLessonPrice: 29.99,
      subtotal: 311.1,
      savings: 11.1,
      savingsPercent: 4,
      allowedRange: { min: 155.55, max: 311.09 },
      error: refuse ? REFUSED : null,
    })),
  };
}

const server = setupServer(
  http.get('*/coach-contracts', () => HttpResponse.json({ contracts })),
  http.get('*/users', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('role') === 'coach') return HttpResponse.json({ users: [COACH, NEW_COACH] });
    return HttpResponse.json({ users: [] });
  }),
  http.post('*/coach-contracts/preview', async ({ request }) =>
    HttpResponse.json(previewFor((await request.json()) as { packs: PrivateLessonPackDraft[] }))
  ),
  http.post('*/coach-contracts', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json({ contract: { ...CURRENT, _id: 'contract-3', coachId: NEW_COACH } }, { status: 201 });
  }),
  http.post('*/coach-contracts/:id/revisions', async ({ params, request }) => {
    revisedId = params.id as string;
    revisedPayload = await request.json();
    return HttpResponse.json(
      { contract: { ...CURRENT, _id: 'contract-3' }, previous: { ...CURRENT, isActive: false } },
      { status: 201 }
    );
  }),
  http.post('*/coach-contracts/:id/deactivate', ({ params }) => {
    deactivatedId = params.id as string;
    return HttpResponse.json({ contract: { ...CURRENT, isActive: false } });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  contracts = [CURRENT, REPLACED];
  createdPayload = null;
  revisedPayload = null;
  revisedId = null;
  deactivatedId = null;
  refuse = false;
});
afterAll(() => server.close());

function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement;
}

describe('AdminCoachContractsPage', () => {
  it('shows the current version with Edit and Deactivate, and the replaced version read-only with its end date', async () => {
    render(<AdminCoachContractsPage />);

    await screen.findAllByText('Dana Cole');
    const current = rowFor('$65.00');
    expect(within(current).getByText('Current')).toBeInTheDocument();
    expect(within(current).getByText('10 × 30 min — $300.00')).toBeInTheDocument();
    expect(within(current).getByRole('button', { name: /edit contract for dana cole/i })).toBeInTheDocument();
    expect(within(current).getByRole('button', { name: /deactivate contract for dana cole/i })).toBeInTheDocument();

    const replaced = rowFor('$60.00');
    expect(within(replaced).getByText('Replaced')).toBeInTheDocument();
    expect(within(replaced).getByText('Sep 1, 2026')).toBeInTheDocument();
    expect(within(replaced).queryByRole('button')).not.toBeInTheDocument();
  });

  it('Edit: prefills the current terms, shows backend lesson prices and pack checks, and saves a new version', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await user.click(await screen.findByRole('button', { name: /edit contract for dana cole/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contract/i });

    expect(within(dialog).getByLabelText(/rate billed to parent/i)).toHaveValue(65);
    expect(within(dialog).getByLabelText(/pack 1 price/i)).toHaveValue(300);
    expect(await within(dialog).findByText('Lesson prices: 30 min $31.11 · 60 min $62.22')).toBeInTheDocument();
    expect(within(dialog).getByText('$29.99 per lesson · saves $11.10 (4%)')).toBeInTheDocument();

    // Nothing changed yet: Save stays off.
    expect(within(dialog).getByRole('button', { name: /^save$/i })).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/rate billed to parent/i));
    await user.type(within(dialog).getByLabelText(/rate billed to parent/i), '70');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^save$/i })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(revisedPayload).toEqual({
        studentBillingRate: 70,
        coachCompensationRate: 40,
        sessionDurationMinutes: 60,
        privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
      })
    );
    expect(revisedId).toBe('contract-2');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit contract/i })).not.toBeInTheDocument());
  });

  it("Edit: disables Save while the backend's preview refuses a pack", async () => {
    refuse = true;
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await user.click(await screen.findByRole('button', { name: /edit contract for dana cole/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contract/i });
    await user.clear(within(dialog).getByLabelText(/pack 1 price/i));
    await user.type(within(dialog).getByLabelText(/pack 1 price/i), '325');

    expect(await within(dialog).findByText(REFUSED)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it("Edit: shows the backend's error on save inline without crashing, and keeps the dialog open", async () => {
    server.use(
      http.post('*/coach-contracts/:id/revisions', () => HttpResponse.json({ message: REFUSED }, { status: 400 }))
    );
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await user.click(await screen.findByRole('button', { name: /edit contract for dana cole/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit contract/i });
    await user.type(within(dialog).getByLabelText(/coach compensation/i), '5');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^save$/i })).toBeEnabled());

    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(REFUSED);
    expect(screen.getByRole('dialog', { name: /edit contract/i })).toBeInTheDocument();
  });

  it('Add: offers only coaches with no current contract and creates one with its packs', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findAllByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /add contract/i }));
    const dialog = await screen.findByRole('dialog', { name: /add contract/i });

    const coachSelect = within(dialog).getByLabelText(/^coach$/i);
    expect(within(coachSelect).queryByRole('option', { name: 'Dana Cole' })).not.toBeInTheDocument();
    await user.selectOptions(coachSelect, 'coach-2');
    await user.type(within(dialog).getByLabelText(/rate billed to parent/i), '60');
    await user.type(within(dialog).getByLabelText(/coach compensation/i), '35');
    await user.click(within(dialog).getByRole('button', { name: /add pack/i }));
    await user.clear(within(dialog).getByLabelText(/pack 1 lesson length/i));
    await user.type(within(dialog).getByLabelText(/pack 1 lesson length/i), '30');
    await user.type(within(dialog).getByLabelText(/pack 1 sessions/i), '5');
    await user.type(within(dialog).getByLabelText(/pack 1 price/i), '140');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^create$/i })).toBeEnabled());

    await user.click(within(dialog).getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createdPayload).toEqual({
        coachId: 'coach-2',
        studentBillingRate: 60,
        coachCompensationRate: 35,
        sessionDurationMinutes: 60,
        privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 5, price: 140 }],
      })
    );
  });

  it('deactivates the current version via the confirm dialog', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await user.click(await screen.findByRole('button', { name: /deactivate contract for dana cole/i }));

    const dialog = await screen.findByRole('dialog', { name: /deactivate contract/i });
    expect(within(dialog).getByText(/will no longer be able to publish/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(deactivatedId).toBe('contract-2'));
  });

  // orphaned-coach-reference-fix-plan D2/D3 — a contract whose coach was
  // deleted must render a fallback label, not crash.
  it("renders a fallback label when the contract's coach was deleted", async () => {
    contracts = [{ ...CURRENT, _id: 'contract-orphan', coachId: null }];
    render(<AdminCoachContractsPage />);

    await screen.findByText('Coach no longer available');
  });
});
