import { render, screen } from '@testing-library/react';

import ProtectedRoute from '../ProtectedRoute';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Testing the guard's own redirect/gating logic in isolation, not a network
// flow — mocking useAuth's return value directly here is consistent with
// docs/TESTING_STRATEGY.md's network-boundary rule (that rule is about not
// mocking services/modules that talk to the network, not about hooks).
const useAuthMock = jest.fn();

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

function Content() {
  return <p>Protected Content</p>;
}

beforeEach(() => {
  pushMock.mockClear();
  useAuthMock.mockReset();
});

describe('ProtectedRoute', () => {
  it('renders nothing while auth is loading', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });

    render(
      <ProtectedRoute>
        <Content />
      </ProtectedRoute>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when not logged in', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });

    render(
      <ProtectedRoute>
        <Content />
      </ProtectedRoute>
    );

    expect(pushMock).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it("redirects to / when the user's role is not in allowedRoles", () => {
    useAuthMock.mockReturnValue({
      user: { _id: 'u1', role: 'student', firstName: 'A', lastName: 'B' },
      loading: false,
    });

    render(
      <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
        <Content />
      </ProtectedRoute>
    );

    expect(pushMock).toHaveBeenCalledWith('/');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when the user is logged in and authorized', () => {
    useAuthMock.mockReturnValue({
      user: { _id: 'u1', role: 'admin', firstName: 'A', lastName: 'B' },
      loading: false,
    });

    render(
      <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
        <Content />
      </ProtectedRoute>
    );

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders children when logged in and no allowedRoles restriction is given', () => {
    useAuthMock.mockReturnValue({
      user: { _id: 'u1', role: 'parent', firstName: 'A', lastName: 'B' },
      loading: false,
    });

    render(
      <ProtectedRoute>
        <Content />
      </ProtectedRoute>
    );

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
