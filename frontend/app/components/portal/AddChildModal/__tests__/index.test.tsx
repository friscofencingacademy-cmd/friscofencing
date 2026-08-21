import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import AddChildModal from '../index';

let postPayload: unknown = null;

const server = setupServer(
  http.post('*/students', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json(
      { student: { _id: 'student-2', firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' } },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  postPayload = null;
});
afterAll(() => server.close());

describe('AddChildModal', () => {
  it('submits the exact { firstName, lastName, skillLevel } payload and calls onSuccess', async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    render(<AddChildModal onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.change(screen.getByLabelText('Skill Level'), { target: { value: 'intermediate' } });

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ firstName: 'New', lastName: 'Kid', skillLevel: 'intermediate' });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose (not onSuccess) when Cancel is clicked, without submitting', () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();

    render(<AddChildModal onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(postPayload).toBeNull();
  });

  it('shows a client-side validation error and does not submit when names are blank', async () => {
    render(<AddChildModal onClose={jest.fn()} onSuccess={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('First name and last name are required.')).toBeInTheDocument();
    expect(postPayload).toBeNull();
  });

  it('shows the backend error message and keeps the dialog open on a failed save', async () => {
    server.use(http.post('*/students', () => HttpResponse.json({ message: 'Failed to add child.' }, { status: 500 })));

    const onSuccess = jest.fn();
    render(<AddChildModal onClose={jest.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('Failed to add child.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
