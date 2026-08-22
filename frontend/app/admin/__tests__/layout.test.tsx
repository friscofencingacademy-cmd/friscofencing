import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AdminLayout from '../layout';
import { AuthProvider } from '../../context/AuthContext';

const pushMock = jest.fn();
let mockPathname = '/admin/dashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => mockPathname,
}));

const ADMIN_USER = {
  _id: 'admin-1',
  role: 'admin',
  firstName: 'Ad',
  lastName: 'Min',
  email: 'admin@example.com',
};

const PARENT_USER = {
  _id: 'parent-1',
  role: 'parent',
  firstName: 'Par',
  lastName: 'Ent',
  email: 'parent@example.com',
};

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  mockPathname = '/admin/dashboard';
});
afterAll(() => server.close());

function renderAdminLayout() {
  return render(
    <AuthProvider>
      <AdminLayout>
        <div>Page content</div>
      </AdminLayout>
    </AuthProvider>
  );
}

describe('AdminLayout', () => {
  it('renders the sidebar sections and page content for an admin user', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderAdminLayout();

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
    expect(screen.getByText('Levels')).toBeInTheDocument();
    expect(screen.getByText('Prices')).toBeInTheDocument();
    expect(screen.getByText('Schedules')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(screen.getByText(/welcome, ad/i)).toBeInTheDocument();
  });

  it('renders for a superadmin user too', async () => {
    server.use(
      http.get('*/auth/me', () =>
        HttpResponse.json({ user: { ...ADMIN_USER, role: 'superadmin' } })
      )
    );

    renderAdminLayout();

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('redirects a parent to "/" and never renders the sidebar or page content', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })));

    renderAdminLayout();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));

    expect(screen.queryByText('Page content')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('redirects a logged-out visitor to "/"', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })));

    renderAdminLayout();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });

  it('marks the nav item matching the current pathname as the active page', async () => {
    mockPathname = '/admin/classes';
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderAdminLayout();

    // Exact match — "Private Classes" (added by the ckq-parity plan's
    // Phase 4 nav) also matches a loose /classes/i pattern.
    const classesLink = await screen.findByRole('link', { name: /^classes$/i });
    expect(classesLink).toHaveAttribute('aria-current', 'page');

    const locationsLink = screen.getByRole('link', { name: /locations/i });
    expect(locationsLink).not.toHaveAttribute('aria-current');
  });

  it('promotes Users to a standalone top-level item, and reorganizes Billing/Programs', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderAdminLayout();
    await screen.findByText('Dashboard');

    // Users is a standalone top-level link now — no "People" section to
    // open first.
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'People' })).not.toBeInTheDocument();

    // The sections these items moved out of no longer exist.
    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Private' })).not.toBeInTheDocument();

    // Section contents are always in the DOM (only a CSS class toggles
    // open/closed), so membership is asserted by scoping to each section's
    // own <li>, not by presence/absence in the whole document.
    await user.click(screen.getByRole('button', { name: 'Billing' }));
    const billingSection = screen.getByRole('button', { name: 'Billing' }).closest('li') as HTMLElement;
    expect(within(billingSection).getByRole('link', { name: 'Prices' })).toBeInTheDocument();
    expect(within(billingSection).queryByRole('link', { name: 'Subscriptions' })).not.toBeInTheDocument();

    // Programs absorbed Schedules, Subscriptions, Private Classes, and
    // Coach Contracts, but not Prices.
    await user.click(screen.getByRole('button', { name: 'Programs' }));
    const programsSection = screen.getByRole('button', { name: 'Programs' }).closest('li') as HTMLElement;
    expect(within(programsSection).getByRole('link', { name: 'Schedules' })).toBeInTheDocument();
    expect(within(programsSection).getByRole('link', { name: 'Subscriptions' })).toBeInTheDocument();
    expect(within(programsSection).getByRole('link', { name: 'Private Classes' })).toBeInTheDocument();
    expect(within(programsSection).getByRole('link', { name: 'Coach Contracts' })).toBeInTheDocument();
    expect(within(programsSection).queryByRole('link', { name: 'Prices' })).not.toBeInTheDocument();
  });

  it('opens and closes the mobile drawer', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderAdminLayout();
    await screen.findByText('Dashboard');

    const openButton = screen.getByRole('button', { name: /open navigation/i });
    fireEvent.click(openButton);

    const closeButton = screen.getByRole('button', { name: /close navigation/i });
    fireEvent.click(closeButton);

    // No crash / still renders the sidebar content after closing.
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('wires the sidebar logout button to AuthContext.logout', async () => {
    server.use(
      http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
      http.post('*/auth/logout', () => HttpResponse.json({ success: true }))
    );

    renderAdminLayout();
    await screen.findByText('Dashboard');

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });
});
