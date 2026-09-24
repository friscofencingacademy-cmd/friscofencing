import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminSettingsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';
import type { Setting } from '../../../../lib/types';

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

const SETTINGS: Setting = {
  registrationFee: 25,
  returningStudentGracePeriodMonths: 6,
  privateClassPackages: [{ quantity: 10, discountPercent: 10 }],
};

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
        privateClassPackages: [{ quantity: 10, discountPercent: 10 }],
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

  // docs/plans/private-class-per-session-booking-plan.md D13 — the page only
  // collects numbers; which packs are valid is the backend's rule.
  describe('private-lesson packs', () => {
    it('shows the saved packs, and adding + removing rows round-trips in the save payload', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByLabelText('Pack 1 sessions')).toHaveValue(10);
      expect(screen.getByLabelText('Pack 1 discount percent')).toHaveValue(10);

      await user.click(screen.getByRole('button', { name: 'Add pack' }));
      await user.type(screen.getByLabelText('Pack 2 sessions'), '20');
      await user.type(screen.getByLabelText('Pack 2 discount percent'), '15');
      await user.click(screen.getByRole('button', { name: 'Remove pack 1' }));
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(patchPayload).toEqual({
          registrationFee: 25,
          returningStudentGracePeriodMonths: 6,
          privateClassPackages: [{ quantity: 20, discountPercent: 15 }],
        })
      );
    });

    it('never submits a pack with no number of sessions', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Add pack' }));
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(await screen.findByText(/each pack needs a number of sessions/i)).toBeInTheDocument();
      expect(patchPayload).toBeNull();
    });

    it("shows the backend's pack rule message verbatim", async () => {
      server.use(
        http.patch('*/settings', () =>
          HttpResponse.json({ message: 'Only one private-lesson pack may have quantity 10' }, { status: 400 })
        )
      );
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Add pack' }));
      await user.type(screen.getByLabelText('Pack 2 sessions'), '10');
      await user.type(screen.getByLabelText('Pack 2 discount percent'), '5');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Only one private-lesson pack may have quantity 10');
    });
  });
});
