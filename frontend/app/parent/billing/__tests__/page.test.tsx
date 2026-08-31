import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ParentBillingPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Par',
  lastName: 'Ent',
  email: 'parent@example.com',
};

const GROUP_ROW = {
  _id: 'reg-1',
  billingShape: 'subscription_cycle',
  status: 'completed',
  amount: 175,
  chargeMethod: 'card',
  manualNote: null,
  paidAt: '2026-02-01T15:00:00.000Z',
  createdAt: '2026-02-01T15:00:00.000Z',
  studentName: 'Kid One',
  description: 'Group Class Registration — Beginner Foil (Beginner)',
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-03-01T00:00:00.000Z',
  sessionDate: null,
  breakdown: { monthlyFee: 150, prorated: false, proratedAmount: null, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 25 },
  invoiceAvailable: true,
};

const MANUAL_ROW = {
  _id: 'reg-2',
  billingShape: 'subscription_cycle',
  status: 'completed',
  amount: 150,
  chargeMethod: 'manual',
  manualNote: 'Paid by check #1042',
  paidAt: '2026-01-01T15:00:00.000Z',
  createdAt: '2026-01-01T15:00:00.000Z',
  studentName: 'Kid One',
  description: 'Group Class Renewal (Manual) — Beginner Foil (Beginner)',
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2026-02-01T00:00:00.000Z',
  sessionDate: null,
  breakdown: { monthlyFee: 150, prorated: false, proratedAmount: null, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
  invoiceAvailable: true,
};

const FAILED_ROW = {
  _id: 'reg-3',
  billingShape: 'subscription_cycle',
  status: 'failed',
  amount: 150,
  chargeMethod: 'card',
  manualNote: null,
  paidAt: null,
  createdAt: '2026-03-01T15:00:00.000Z',
  studentName: 'Kid One',
  description: 'Group Class Renewal — Beginner Foil (Beginner)',
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-04-01T00:00:00.000Z',
  sessionDate: null,
  breakdown: { monthlyFee: 150, prorated: false, proratedAmount: null, siblingDiscountApplied: false, siblingDiscountAmount: 0, registrationFeeCharged: 0 },
  invoiceAvailable: false,
};

const PRIVATE_ROW = {
  _id: 'reg-4',
  billingShape: 'per_session',
  status: 'completed',
  amount: 65,
  chargeMethod: 'card',
  manualNote: null,
  paidAt: '2026-02-03T21:00:00.000Z',
  createdAt: '2026-02-03T21:00:00.000Z',
  studentName: 'Kid One',
  description: 'Private Lesson with Dana Coach',
  periodStart: null,
  periodEnd: null,
  sessionDate: '2026-02-03T21:00:00.000Z',
  breakdown: null,
  invoiceAvailable: true,
};

let historyResponse: unknown[] = [GROUP_ROW, MANUAL_ROW, FAILED_ROW, PRIVATE_ROW];

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })),
  http.get('*/registrations/history', () => HttpResponse.json({ history: historyResponse }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  historyResponse = [GROUP_ROW, MANUAL_ROW, FAILED_ROW, PRIVATE_ROW];
});
afterAll(() => server.close());

function renderBillingPage() {
  return render(
    <AuthProvider>
      <ParentBillingPage />
    </AuthProvider>
  );
}

describe('ParentBillingPage', () => {
  it('renders one row per ledger entry, across billing shapes, with amount/status/method/description', async () => {
    renderBillingPage();

    await screen.findByText('Group Class Registration — Beginner Foil (Beginner)');

    const table = screen.getByRole('table');
    const paidRow = within(table).getByText('$175.00').closest('tr') as HTMLElement;
    expect(within(paidRow).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('Private Lesson with Dana Coach')).toBeInTheDocument();
    expect(within(table).getByText('$65.00')).toBeInTheDocument();
  });

  it('shows a "Manual" chip and the note for a manually-recorded payment', async () => {
    renderBillingPage();

    await screen.findByText('Paid by check #1042');

    const manualRow = screen.getByText('Paid by check #1042').closest('tr') as HTMLElement;
    expect(within(manualRow).getByText('Manual')).toBeInTheDocument();
  });

  it('shows "Failed" status and no download link for a non-completed row', async () => {
    renderBillingPage();

    await screen.findByText('Failed');

    const failedRow = screen.getByText('Failed').closest('tr') as HTMLElement;
    expect(within(failedRow).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('renders a real download link, pointed at the invoice endpoint, for a completed row', async () => {
    renderBillingPage();

    await screen.findByText('$175.00');

    const paidRow = screen.getByText('$175.00').closest('tr') as HTMLElement;
    const downloadLink = within(paidRow).getByRole('link', { name: /download/i });
    expect(downloadLink).toHaveAttribute('href', expect.stringContaining('/registrations/reg-1/invoice'));
  });

  it('shows a message when there is no payment history yet', async () => {
    historyResponse = [];
    renderBillingPage();

    expect(await screen.findByText(/no payments yet/i)).toBeInTheDocument();
  });
});
