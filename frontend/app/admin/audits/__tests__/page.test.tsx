import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AuditsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const SUPERADMIN_USER = {
  _id: 'super-1',
  role: 'superadmin',
  firstName: 'Super',
  lastName: 'Admin',
  email: 'super@example.com',
};

const ADMIN_USER = {
  _id: 'admin-1',
  role: 'admin',
  firstName: 'Regular',
  lastName: 'Admin',
  email: 'admin@example.com',
};

const RUN = {
  _id: 'run-1',
  auditName: 'audit-live-registration',
  group: null,
  overall: 'pass',
  scenarios: [
    { id: 'S1', name: 'Trial booking', result: 'pass', note: '' },
    { id: 'S4', name: 'Decline path', result: 'skip', note: 'no decline-test parent available' },
  ],
  summary: '3/4 scenarios passed.',
  startedAt: '2026-08-23T14:00:00.000Z',
  finishedAt: '2026-08-23T14:05:00.000Z',
  runner: 'playwright-script',
  createdAt: '2026-08-23T14:05:00.000Z',
  updatedAt: '2026-08-23T14:05:00.000Z',
};

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: SUPERADMIN_USER })),
  http.get('*/audit-runs', () => HttpResponse.json({ data: { runs: [RUN], total: 1 } }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <AuditsPage />
    </AuthProvider>
  );
}

describe('AuditsPage', () => {
  it('renders one row per known audit, with the latest result and relative last-run time', async () => {
    renderPage();

    expect(await screen.findByText('Live Registration')).toBeInTheDocument();
    expect(screen.getByText(/✓ Pass/)).toBeInTheDocument();
  });

  it('shows "Never run" for a known audit with no reported run yet', async () => {
    server.use(http.get('*/audit-runs', () => HttpResponse.json({ data: { runs: [], total: 0 } })));

    renderPage();

    expect(await screen.findByText('Never run')).toBeInTheDocument();
  });

  it('expands to show per-scenario detail on click', async () => {
    renderPage();

    const row = await screen.findByText('Live Registration');
    fireEvent.click(row);

    expect(await screen.findByText('Trial booking')).toBeInTheDocument();
    expect(screen.getByText('Decline path')).toBeInTheDocument();
    expect(screen.getByText('no decline-test parent available')).toBeInTheDocument();
    expect(screen.getByText('3/4 scenarios passed.')).toBeInTheDocument();
  });

  it('denies access to a non-superadmin admin', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderPage();

    expect(await screen.findByText(/access denied — superadmin only/i)).toBeInTheDocument();
    expect(screen.queryByText('Live Registration')).not.toBeInTheDocument();
  });

  it('shows a retry option on a failed load, which recovers', async () => {
    server.use(http.get('*/audit-runs', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(http.get('*/audit-runs', () => HttpResponse.json({ data: { runs: [RUN], total: 1 } })));

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText(/✓ Pass/)).toBeInTheDocument();
    });
  });
});
