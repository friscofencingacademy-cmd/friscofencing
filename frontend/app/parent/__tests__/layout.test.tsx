import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ParentLayout from '../layout';
import { AuthProvider } from '../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/parent/dashboard',
}));

const PARENT_USER = { _id: 'parent-1', role: 'parent', firstName: 'Par', lastName: 'Ent', email: 'parent@example.com' };
const ADMIN_USER = { _id: 'admin-1', role: 'admin', firstName: 'Ad', lastName: 'Min', email: 'admin@example.com' };

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] }))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  window.history.pushState({}, '', '/parent/dashboard');
});
afterAll(() => server.close());

function renderLayout() {
  return render(
    <AuthProvider>
      <ParentLayout>
        <div>Page content</div>
      </ParentLayout>
    </AuthProvider>
  );
}

describe('ParentLayout', () => {
  it('renders the portal shell and page content for a parent user', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: PARENT_USER })));

    renderLayout();

    expect(await screen.findByText('Page content')).toBeInTheDocument();
    expect(screen.getByText(/welcome back, par/i)).toBeInTheDocument();
  });

  it('redirects a non-parent user to "/"', async () => {
    server.use(http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLayout();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('Page content')).not.toBeInTheDocument();
  });

  // A logged-out visitor is sent to log in/register instead of being
  // silently bounced home — the fixed bug: clicking "Book this slot" on the
  // public /private-classes page while logged out used to land on / with no
  // explanation. ?next= carries them back to the exact page (query string
  // included) once they authenticate.
  it('redirects a logged-out visitor to /login, carrying the attempted path + query as ?next=', async () => {
    window.history.pushState({}, '', '/parent/register-private?slot=abc123');
    server.use(http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })));

    renderLayout();

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/parent/register-private?slot=abc123')}`
      )
    );
  });
});
