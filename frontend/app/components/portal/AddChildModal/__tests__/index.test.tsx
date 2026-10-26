import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../../test-utils/msw';

import AddChildModal from '../index';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

let postPayload: unknown = null;

const server = setupServer(
  http.post('*/students', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json(
      {
        student: {
          _id: 'student-2',
          firstName: 'New',
          lastName: 'Kid',
          skillLevel: 'beginner',
          dateOfBirth: '2018-01-01',
          age: 8,
        },
      },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  postPayload = null;
});
afterAll(() => server.close());

describe('AddChildModal', () => {
  it('submits the exact { firstName, lastName, skillLevel, dateOfBirth } payload and calls onSuccess', async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    render(<AddChildModal onClose={onClose} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('First Name'), 'New');
    await user.type(screen.getByLabelText('Last Name'), 'Kid');
    await user.type(screen.getByLabelText('Date of Birth'), '2018-01-01');
    await user.selectOptions(screen.getByLabelText('Skill Level'), 'intermediate');

    await user.click(screen.getByRole('button', { name: /add child/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({
        firstName: 'New',
        lastName: 'Kid',
        skillLevel: 'intermediate',
        dateOfBirth: '2018-01-01',
      });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose (not onSuccess) when Cancel is clicked, without submitting', async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    render(<AddChildModal onClose={onClose} onSuccess={onSuccess} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(postPayload).toBeNull();
  });

  it('shows a client-side validation error and does not submit when names are blank', async () => {
    render(<AddChildModal onClose={jest.fn()} onSuccess={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('First name and last name are required.')).toBeInTheDocument();
    expect(postPayload).toBeNull();
  });

  // docs/plans/trial-registration-required-fields-plan.md §1.3.
  it('shows a client-side validation error and does not submit when date of birth is blank', async () => {
    render(<AddChildModal onClose={jest.fn()} onSuccess={jest.fn()} />);

    await user.type(screen.getByLabelText('First Name'), 'New');
    await user.type(screen.getByLabelText('Last Name'), 'Kid');
    await user.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText("Child's date of birth is required.")).toBeInTheDocument();
    expect(postPayload).toBeNull();
  });

  it('shows the backend error message and keeps the dialog open on a failed save', async () => {
    server.use(http.post('*/students', () => HttpResponse.json({ message: 'Failed to add child.' }, { status: 500 })));

    const onSuccess = jest.fn();
    render(<AddChildModal onClose={jest.fn()} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('First Name'), 'New');
    await user.type(screen.getByLabelText('Last Name'), 'Kid');
    await user.type(screen.getByLabelText('Date of Birth'), '2018-01-01');
    await user.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('Failed to add child.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
