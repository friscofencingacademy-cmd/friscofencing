import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../test-utils/msw';

import LoginPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

const pushMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));

// Wildcard host pattern so these handlers match the relative `/api/v1`
// baseURL whatever origin jsdom resolves it against — mocking at the real
// network boundary per docs/TESTING_STRATEGY.md, not
// jest.mock('../../../lib/api').
const server = setupServer(
  http.get('*/auth/me', () => new HttpResponse(null, { status: 401 }))
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderLoginPage() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  );
}

async function fillAndSubmit(email: string, password: string) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginPage', () => {
  it.each([
    ['parent', '/parent/dashboard'],
    ['coach', '/coach/schedules'],
    ['admin', '/admin/dashboard'],
    ['superadmin', '/admin/dashboard'],
  ])('logs in as %s and redirects straight to %s (no interim screen)', async (role, expectedPath) => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({
          user: {
            _id: 'user-1',
            role,
            firstName: 'Test',
            lastName: 'User',
            email: 'test-user@example.com',
          },
        })
      )
    );

    renderLoginPage();

    await fillAndSubmit('test-user@example.com', 'correct-password');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(expectedPath);
    });
  });

  it('honors ?next= over the role default on success', async () => {
    mockSearchParams = new URLSearchParams({ next: '/parent/book-trial' });

    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({
          user: {
            _id: 'user-2',
            role: 'parent',
            firstName: 'Next',
            lastName: 'Parent',
            email: 'next-parent@example.com',
          },
        })
      )
    );

    renderLoginPage();

    await fillAndSubmit('next-parent@example.com', 'correct-password');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/parent/book-trial');
    });
  });

  it('shows an inline error message on a failed login', async () => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 })
      )
    );

    renderLoginPage();

    await fillAndSubmit('test-parent@example.com', 'wrong-password');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    });

    expect(pushMock).not.toHaveBeenCalled();
  });
});
