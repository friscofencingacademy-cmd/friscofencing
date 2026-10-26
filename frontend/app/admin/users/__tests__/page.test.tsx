import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import UsersPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

const replaceMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

const PARENT = { _id: 'parent-1', role: 'parent', firstName: 'Pat', lastName: 'Parent', email: 'pat@example.com' };
const COACH = { _id: 'coach-1', role: 'coach', firstName: 'Cody', lastName: 'Coach', email: 'cody@example.com' };
const ADMIN_ROW = { _id: 'admin-1', role: 'admin', firstName: 'Amy', lastName: 'Admin', email: 'amy@example.com' };
const STUDENT = { _id: 'student-1', role: 'student', firstName: 'Sam', lastName: 'Student', parentId: 'parent-1' };
const SUPERADMIN_ROW = { _id: 'super-1', role: 'superadmin', firstName: 'Sue', lastName: 'Super', email: 'sue@example.com' };

const ALL_USERS = [PARENT, COACH, ADMIN_ROW, STUDENT, SUPERADMIN_ROW];

const ADMIN_CURRENT_USER = { _id: 'current-admin', role: 'admin', firstName: 'Cur', lastName: 'Admin', email: 'cur-admin@example.com' };
const SUPERADMIN_CURRENT_USER = {
  _id: 'current-super',
  role: 'superadmin',
  firstName: 'Cur',
  lastName: 'Super',
  email: 'cur-super@example.com',
};

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let updatedId: string | null = null;
let passwordPayload: unknown = null;
let passwordId: string | null = null;
let deletedId: string | null = null;
const queriedRoles: (string | null)[] = [];

const server = setupServer(
  http.get('*/users', ({ request }) => {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    queriedRoles.push(role);
    const users = role ? ALL_USERS.filter((u) => u.role === role) : ALL_USERS;
    return HttpResponse.json({ users });
  }),
  http.post('*/users', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { user: { _id: 'new-user', role: 'parent', firstName: 'New', lastName: 'User', email: 'new@example.com' } },
      { status: 201 }
    );
  }),
  http.put('*/users/:id/password', async ({ request, params }) => {
    passwordPayload = await request.json();
    passwordId = params.id as string;
    return HttpResponse.json({ success: true });
  }),
  http.put('*/users/:id', async ({ request, params }) => {
    updatedPayload = await request.json();
    updatedId = params.id as string;
    return HttpResponse.json({ user: { ...COACH, ...(updatedPayload as object) } });
  }),
  http.delete('*/users/:id', ({ params }) => {
    deletedId = params.id as string;
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  createdPayload = null;
  updatedPayload = null;
  updatedId = null;
  passwordPayload = null;
  passwordId = null;
  deletedId = null;
  queriedRoles.length = 0;
  replaceMock.mockClear();
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderPage(currentRole: 'admin' | 'superadmin' = 'admin') {
  const currentUser = currentRole === 'admin' ? ADMIN_CURRENT_USER : SUPERADMIN_CURRENT_USER;
  server.use(http.get('*/auth/me', () => HttpResponse.json({ user: currentUser })));

  return render(
    <AuthProvider>
      <UsersPage />
    </AuthProvider>
  );
}

describe('UsersPage', () => {
  it('renders the users table with role tabs', async () => {
    renderPage('admin');

    expect(await screen.findByText('Pat Parent')).toBeInTheDocument();
    expect(screen.getByText('Cody Coach')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parent' })).toBeInTheDocument();
  });

  it('switches tabs and re-fetches with the corresponding role filter', async () => {
    renderPage('admin');
    await screen.findByText('Pat Parent');

    await user.click(screen.getByRole('button', { name: 'Coach' }));

    await waitFor(() => expect(queriedRoles).toContain('coach'));
    expect(await screen.findByText('Cody Coach')).toBeInTheDocument();
    expect(screen.queryByText('Pat Parent')).not.toBeInTheDocument();
  });

  it('hides the Superadmin tab for an admin user', async () => {
    renderPage('admin');
    await screen.findByText('Pat Parent');

    expect(screen.queryByRole('button', { name: 'Superadmin' })).not.toBeInTheDocument();
  });

  it('shows the Superadmin tab for a superadmin user', async () => {
    renderPage('superadmin');
    await screen.findByText('Pat Parent');

    expect(screen.getByRole('button', { name: 'Superadmin' })).toBeInTheDocument();
  });

  it('a superadmin row has no edit/password/delete actions when viewed as admin', async () => {
    renderPage('admin');
    await screen.findByText('Sue Super');

    expect(screen.queryByRole('button', { name: /edit sue super/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change password for sue super/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete sue super/i })).not.toBeInTheDocument();
  });

  describe('Create', () => {
    it('shows email+password for a login-capable role and excludes superadmin from the role dropdown for an admin', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));

      const roleSelect = screen.getByLabelText('Role') as HTMLSelectElement;
      const optionLabels = Array.from(roleSelect.options).map((o) => o.label);
      expect(optionLabels).not.toContain('Superadmin');

      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Parent')).not.toBeInTheDocument();
    });

    it('includes superadmin in the role dropdown for a superadmin', async () => {
      renderPage('superadmin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));

      const roleSelect = screen.getByLabelText('Role') as HTMLSelectElement;
      const optionLabels = Array.from(roleSelect.options).map((o) => o.label);
      expect(optionLabels).toContain('Superadmin');
    });

    it('shows the parent picker and skill level, and no password, when role is student', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.selectOptions(screen.getByLabelText('Role'), 'student');

      expect(screen.getByLabelText('Parent')).toBeInTheDocument();
      expect(screen.getByLabelText('Skill Level')).toBeInTheDocument();
      expect(screen.getByLabelText('Email (optional)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    });

    it('submits the exact create payload for a login-capable role', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.selectOptions(screen.getByLabelText('Role'), 'coach');
      await user.type(screen.getByLabelText('First Name'), 'New');
      await user.type(screen.getByLabelText('Last Name'), 'Coach');
      await user.type(screen.getByLabelText('Email'), 'newcoach@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toEqual({
          role: 'coach',
          firstName: 'New',
          lastName: 'Coach',
          email: 'newcoach@example.com',
          password: 'password123',
        });
      });
    });

    // docs/plans/kiosk-signin-plan.md K1 — the front-desk tablet's account is
    // login-capable, so it gets email + password like a coach.
    it('offers a Kiosk (sign-in tablet) account and submits it with email and password', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      const roleSelect = screen.getByLabelText('Role') as HTMLSelectElement;
      expect(Array.from(roleSelect.options).map((o) => o.label)).toContain('Kiosk (sign-in tablet)');

      await user.selectOptions(roleSelect, 'kiosk');
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Parent')).not.toBeInTheDocument();

      await user.type(screen.getByLabelText('First Name'), 'Front');
      await user.type(screen.getByLabelText('Last Name'), 'Desk');
      await user.type(screen.getByLabelText('Email'), 'frontdesk@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toEqual({
          role: 'kiosk',
          firstName: 'Front',
          lastName: 'Desk',
          email: 'frontdesk@example.com',
          password: 'password123',
        });
      });
    });

    it('submits the exact create payload for a student, with parentId and no password', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.selectOptions(screen.getByLabelText('Role'), 'student');
      await user.type(screen.getByLabelText('First Name'), 'Kid');
      await user.type(screen.getByLabelText('Last Name'), 'One');
      await user.selectOptions(screen.getByLabelText('Parent'), 'parent-1');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toEqual({
          role: 'student',
          firstName: 'Kid',
          lastName: 'One',
          parentId: 'parent-1',
        });
      });
    });

    // docs/plans/trial-registration-required-fields-plan.md §2.4 — present
    // but never `required`, matching the backend's own "don't force it
    // here" decision (§1.3).
    it('includes dateOfBirth in the create payload for a student when filled, and offers it as optional', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.selectOptions(screen.getByLabelText('Role'), 'student');

      const dobInput = screen.getByLabelText('Date of Birth (optional)');
      expect(dobInput).not.toBeRequired();

      await user.type(screen.getByLabelText('First Name'), 'Kid');
      await user.type(screen.getByLabelText('Last Name'), 'WithBirthday');
      await user.selectOptions(screen.getByLabelText('Parent'), 'parent-1');
      await user.clear(dobInput);
      await user.type(dobInput, '2018-01-01');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toMatchObject({ dateOfBirth: '2018-01-01' });
      });
    });

    it('includes phone in the create payload for a login-capable role when filled, and offers it as optional', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /add user/i }));
      await user.selectOptions(screen.getByLabelText('Role'), 'coach');

      const phoneInput = screen.getByLabelText('Phone (optional)');
      expect(phoneInput).not.toBeRequired();

      await user.type(screen.getByLabelText('First Name'), 'New');
      await user.type(screen.getByLabelText('Last Name'), 'Coach');
      await user.type(screen.getByLabelText('Email'), 'newcoach2@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.clear(phoneInput);
      await user.type(phoneInput, '555-123-4567');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toMatchObject({ phone: '555-123-4567' });
      });
    });
  });

  describe('Edit', () => {
    it('renders role as read-only text (not a select) and submits only firstName/lastName/email', async () => {
      renderPage('admin');
      await screen.findByText('Cody Coach');

      await user.click(screen.getByRole('button', { name: /edit cody coach/i }));

      const dialog = screen.getByRole('dialog', { name: /edit user/i });
      expect(within(dialog).queryAllByRole('combobox')).toHaveLength(0);
      expect(within(dialog).getByText('Coach')).toBeInTheDocument();

      await user.clear(screen.getByLabelText('First Name'));
      await user.type(screen.getByLabelText('First Name'), 'Codster');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(updatedId).toBe('coach-1');
        expect(updatedPayload).toEqual({
          firstName: 'Codster',
          lastName: 'Coach',
          email: 'cody@example.com',
        });
      });
    });

    // docs/plans/trial-registration-required-fields-plan.md's admin-backfill
    // stop-gap — this is the only place an existing login-capable account
    // (created before phone existed, or via a create() call that left it
    // blank) can ever have a phone added after the fact.
    it("lets an admin backfill an existing coach's phone via edit", async () => {
      renderPage('admin');
      await screen.findByText('Cody Coach');

      await user.click(screen.getByRole('button', { name: /edit cody coach/i }));

      const phoneInput = screen.getByLabelText('Phone (optional)');
      expect(phoneInput).not.toBeRequired();
      await user.clear(phoneInput);
      await user.type(phoneInput, '555-987-6543');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(updatedPayload).toMatchObject({ phone: '555-987-6543' });
      });
    });

    it("lets an admin backfill an existing student's dateOfBirth via edit", async () => {
      renderPage('admin');
      await screen.findByText('Sam Student');

      await user.click(screen.getByRole('button', { name: /edit sam student/i }));

      const dobInput = screen.getByLabelText('Date of Birth (optional)');
      expect(dobInput).not.toBeRequired();
      await user.clear(dobInput);
      await user.type(dobInput, '2018-01-01');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(updatedPayload).toMatchObject({ dateOfBirth: '2018-01-01' });
      });
    });
  });

  describe('Change Password', () => {
    it('opens from the Key icon and submits to the password endpoint, not the profile endpoint', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /change password for pat parent/i }));

      expect(screen.getByRole('dialog', { name: /change password/i })).toBeInTheDocument();

      await user.type(screen.getByLabelText('New Password'), 'brandnewpassword');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(passwordId).toBe('parent-1');
        expect(passwordPayload).toEqual({ password: 'brandnewpassword' });
      });

      expect(updatedPayload).toBeNull();
    });
  });

  describe('Delete', () => {
    it('removes the row on a successful delete', async () => {
      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /delete pat parent/i }));
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => expect(deletedId).toBe('parent-1'));
      await waitFor(() => expect(screen.queryByText('Pat Parent')).not.toBeInTheDocument());
    });

    it('shows the backend 409 message in a "Cannot Delete" dialog when blocked', async () => {
      server.use(
        http.delete('*/users/:id', () =>
          HttpResponse.json({ message: 'Cannot delete: 1 child account(s) reference this parent.' }, { status: 409 })
        )
      );

      renderPage('admin');
      await screen.findByText('Pat Parent');

      await user.click(screen.getByRole('button', { name: /delete pat parent/i }));
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(await screen.findByText('Cannot Delete')).toBeInTheDocument();
      expect(screen.getByText('Cannot delete: 1 child account(s) reference this parent.')).toBeInTheDocument();

      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));
      expect(screen.getByText('Pat Parent')).toBeInTheDocument();
    });
  });
});
