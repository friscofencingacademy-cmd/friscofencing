import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminCoachContractsPage from '../page';

const COACH = { _id: 'coach-1', role: 'coach', firstName: 'Dana', lastName: 'Cole', email: 'dana@example.com' };

const CONTRACT = {
  _id: 'contract-1',
  coachId: COACH,
  studentBillingRate: 65,
  coachCompensationRate: 40,
  sessionDurationMinutes: 60,
  effectiveFrom: '2026-08-01T00:00:00.000Z',
  isActive: true,
};

let contracts: unknown[] = [CONTRACT];
let createdPayload: unknown = null;
let deactivatedId: string | null = null;

const server = setupServer(
  http.get('*/coach-contracts', () => HttpResponse.json({ contracts })),
  http.get('*/users', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('role') === 'coach') return HttpResponse.json({ users: [COACH] });
    return HttpResponse.json({ users: [] });
  }),
  http.post('*/coach-contracts', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { contract: { ...CONTRACT, _id: 'contract-2', studentBillingRate: 70 } },
      { status: 201 }
    );
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
  deactivatedId = null;
});
afterAll(() => server.close());

describe('AdminCoachContractsPage', () => {
  it('renders the contracts table with rate/duration/status', async () => {
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    expect(screen.getByText('$65.00')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('creates a new contract with the exact payload', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /add contract/i }));

    const dialog = await screen.findByRole('dialog', { name: /add contract/i });
    await user.selectOptions(within(dialog).getByLabelText(/^coach$/i), 'coach-1');
    await user.type(within(dialog).getByLabelText(/rate billed to parent/i), '70');
    await user.type(within(dialog).getByLabelText(/coach compensation/i), '45');

    await user.click(within(dialog).getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createdPayload).toEqual({
        coachId: 'coach-1',
        studentBillingRate: 70,
        coachCompensationRate: 45,
        sessionDurationMinutes: 60,
      })
    );
  });

  it('deactivates a contract via the confirm dialog', async () => {
    const user = userEvent.setup();
    render(<AdminCoachContractsPage />);

    await screen.findByText('Dana Cole');
    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will no longer be able to publish/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(deactivatedId).toBe('contract-1'));
  });

  // orphaned-coach-reference-fix-plan D2/D3 — a contract whose coach was
  // deleted must render a fallback label, not crash.
  it('renders a fallback label when the contract\'s coach was deleted', async () => {
    contracts = [{ ...CONTRACT, _id: 'contract-orphan', coachId: null }];
    render(<AdminCoachContractsPage />);

    await screen.findByText('Coach no longer available');
  });
});
