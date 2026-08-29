import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AppShell from '../AppShell';
import { AuthProvider } from '../../../context/AuthContext';

const server = setupServer(
  http.get('*/auth/me', () => new HttpResponse(null, { status: 401 }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderShell() {
  return render(
    <AuthProvider>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </AuthProvider>
  );
}

describe('AppShell', () => {
  it('renders the public nav (Home, Programs, Our Team, Private Lessons, Log In, Take a Trial Class) when logged out', async () => {
    renderShell();

    // Waits out AuthProvider's /auth/me restore before asserting the
    // logged-out branch is the final render, not a transient loading state.
    await screen.findByText('page content');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/classes');
    expect(screen.getByRole('link', { name: 'Our Team' })).toHaveAttribute('href', '/coaches');
    expect(screen.getByRole('link', { name: 'Private Lessons' })).toHaveAttribute(
      'href',
      '/private-classes'
    );
    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Take a Trial Class' })).toHaveAttribute(
      'href',
      '/register'
    );
  });

  it('renders the authenticated coach nav, not the public nav, when logged in as a coach', async () => {
    server.use(
      http.get('*/auth/me', () =>
        HttpResponse.json({
          user: { _id: 'coach-1', role: 'coach', firstName: 'Jane', lastName: 'Coach' },
        })
      )
    );

    renderShell();

    expect(await screen.findByText('Welcome, Jane')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Schedules' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Take a Trial Class' })).not.toBeInTheDocument();
  });
});
