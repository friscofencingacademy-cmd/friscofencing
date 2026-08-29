import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminSettingsPage from '../page';
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

const SETTINGS = { registrationFee: 25, returningStudentGracePeriodMonths: 6 };

let patchPayload: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: SUPERADMIN_USER })),
  http.get('*/settings', () => HttpResponse.json({ settings: SETTINGS })),
  http.patch('*/settings', async ({ request }) => {
    patchPayload = await request.json();
    return HttpResponse.json({ settings: { ...SETTINGS, ...(patchPayload as object) } });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  patchPayload = null;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <AdminSettingsPage />
    </AuthProvider>
  );
}

describe('AdminSettingsPage', () => {
  it('loads and displays the current registration fee and grace period', async () => {
    renderPage();

    expect(await screen.findByLabelText('Default Registration Fee ($)')).toHaveValue(25);
    expect(screen.getByLabelText('Waive if returning within (months)')).toHaveValue(6);
  });

  it('saves an edited value and shows a confirmation', async () => {
    renderPage();

    const feeInput = await screen.findByLabelText('Default Registration Fee ($)');
    fireEvent.change(feeInput, { target: { value: '40' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(patchPayload).toEqual({
        registrationFee: 40,
        returningStudentGracePeriodMonths: 6,
      });
    });

    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });

  it('shows a client-side error and never submits for a negative fee', async () => {
    renderPage();

    const feeInput = await screen.findByLabelText('Default Registration Fee ($)');
    fireEvent.change(feeInput, { target: { value: '-5' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/must be a number/i)).toBeInTheDocument();
    expect(patchPayload).toBeNull();
  });

  it('shows the backend error inline when the save request fails', async () => {
    server.use(http.patch('*/settings', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderPage();

    const feeInput = await screen.findByLabelText('Default Registration Fee ($)');
    fireEvent.change(feeInput, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('denies access to a non-superadmin admin', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderPage();

    expect(await screen.findByText(/access denied — superadmin only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Default Registration Fee ($)')).not.toBeInTheDocument();
  });

  it('shows a retry option on a failed load, which recovers', async () => {
    server.use(http.get('*/settings', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(http.get('*/settings', () => HttpResponse.json({ settings: SETTINGS })));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByLabelText('Default Registration Fee ($)')).toHaveValue(25);
  });
});
