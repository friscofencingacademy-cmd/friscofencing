import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../test-utils/msw';

import RegisterPage from '../page';
import { AuthProvider, useAuth } from '../../context/AuthContext';

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

// Wildcard host pattern, matching the network-boundary MSW convention
// established in app/login/__tests__/page.test.tsx.
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

// Renders once AuthProvider's session check (GET /auth/me) has settled, so a
// test that asserts only on the first render can wait for it to finish
// instead of letting it land after the test, outside act().
function AuthSettled() {
  const { loading } = useAuth();
  return loading ? null : <span data-testid="auth-settled" />;
}

function renderRegisterPage() {
  return render(
    <AuthProvider>
      <RegisterPage />
      <AuthSettled />
    </AuthProvider>
  );
}

async function fillAndSubmit(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  // Required on the form (docs/plans/trial-registration-required-fields-
  // plan.md §2.1) — every call site fills it, since leaving it blank would
  // block the native HTML5 form submission before handleSubmit ever runs.
  phone = '555-123-4567'
) {
  await user.type(screen.getByLabelText('First Name'), firstName);
  await user.type(screen.getByLabelText('Last Name'), lastName);
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Phone Number'), phone);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: /sign up/i }));
}

describe('RegisterPage', () => {
  // docs/plans/trial-registration-required-fields-plan.md §2.1.
  it('shows the trial-class info section above the signup form', async () => {
    renderRegisterPage();

    expect(screen.getByText('Your First Class Is Free')).toBeInTheDocument();
    expect(screen.getByText(/basic fencing movements and footwork/i)).toBeInTheDocument();
    expect(screen.getByText(/what to bring/i)).toBeInTheDocument();
    expect(await screen.findByTestId('auth-settled')).toBeInTheDocument();
  });

  it('submits phone in the registration payload — required for trial-class booking later', async () => {
    let postPayload: unknown = null;

    server.use(
      http.post('*/auth/register', async ({ request }) => {
        postPayload = await request.json();
        return HttpResponse.json(
          {
            user: {
              _id: 'user-phone',
              role: 'parent',
              firstName: 'Phone',
              lastName: 'Parent',
              email: 'phone-parent@example.com',
              phone: '555-987-6543',
            },
          },
          { status: 201 }
        );
      })
    );

    renderRegisterPage();

    await fillAndSubmit('Phone', 'Parent', 'phone-parent@example.com', 'a-strong-password', '555-987-6543');

    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(postPayload).toEqual({
      firstName: 'Phone',
      lastName: 'Parent',
      email: 'phone-parent@example.com',
      password: 'a-strong-password',
      phone: '555-987-6543',
    });
  });

  it('signs up successfully and redirects to /parent/dashboard by default', async () => {
    server.use(
      http.post('*/auth/register', () =>
        HttpResponse.json(
          {
            user: {
              _id: 'user-1',
              role: 'parent',
              firstName: 'New',
              lastName: 'Parent',
              email: 'new-parent@example.com',
            },
          },
          { status: 201 }
        )
      )
    );

    renderRegisterPage();

    expect(
      screen.getByText(/free to create\. you'll add your child and pick a trial class next/i)
    ).toBeInTheDocument();

    await fillAndSubmit('New', 'Parent', 'new-parent@example.com', 'a-strong-password');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/parent/dashboard');
    });
  });

  it('honors ?next= and redirects there instead of the default on success', async () => {
    mockSearchParams = new URLSearchParams({ next: '/parent/book-trial' });

    server.use(
      http.post('*/auth/register', () =>
        HttpResponse.json(
          {
            user: {
              _id: 'user-2',
              role: 'parent',
              firstName: 'Next',
              lastName: 'Parent',
              email: 'next-parent@example.com',
            },
          },
          { status: 201 }
        )
      )
    );

    renderRegisterPage();

    await fillAndSubmit('Next', 'Parent', 'next-parent@example.com', 'a-strong-password');

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/parent/book-trial');
    });
  });

  it('shows an inline error message on a 409 duplicate-email response, without crashing', async () => {
    server.use(
      http.post('*/auth/register', () =>
        HttpResponse.json(
          { message: 'An account with this email already exists' },
          { status: 409 }
        )
      )
    );

    renderRegisterPage();

    await fillAndSubmit('Dup', 'Parent', 'dup-parent@example.com', 'a-strong-password');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'An account with this email already exists'
      );
    });

    expect(pushMock).not.toHaveBeenCalled();
  });
});
