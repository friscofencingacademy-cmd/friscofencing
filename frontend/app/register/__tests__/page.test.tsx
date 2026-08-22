import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

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

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderRegisterPage() {
  return render(
    <AuthProvider>
      <RegisterPage />
    </AuthProvider>
  );
}

async function fillAndSubmit(
  firstName: string,
  lastName: string,
  email: string,
  password: string
) {
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: firstName } });
  fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: lastName } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
}

describe('RegisterPage', () => {
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
