import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import LevelsPage from '../page';

const EXISTING_LEVEL = { _id: 'level-1', name: 'Beginner', order: 1 };

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/levels', () => HttpResponse.json({ levels: [EXISTING_LEVEL] })),
  http.post('*/levels', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json({ level: { _id: 'level-2', name: 'Advanced', order: 2 } }, { status: 201 });
  }),
  http.put('*/levels/:id', async ({ request }) => {
    updatedPayload = await request.json();
    return HttpResponse.json({ level: { _id: 'level-1', name: 'Beginner Updated', order: 1 } });
  }),
  http.delete('*/levels/:id', ({ params }) => {
    deletedId = params.id as string;
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  createdPayload = null;
  updatedPayload = null;
  deletedId = null;
});
afterAll(() => server.close());

describe('LevelsPage', () => {
  it('renders the existing levels table', async () => {
    render(<LevelsPage />);

    expect(await screen.findByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('creates a new level with the exact payload', async () => {
    render(<LevelsPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /add level/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Advanced' } });
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '2' } });

    server.use(
      http.get('*/levels', () =>
        HttpResponse.json({ levels: [EXISTING_LEVEL, { _id: 'level-2', name: 'Advanced', order: 2 }] })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ name: 'Advanced', order: 2 });
    });

    expect(await screen.findByText('Advanced')).toBeInTheDocument();
  });

  it('edits a level, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<LevelsPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /edit beginner/i }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Beginner');
    const orderInput = screen.getByLabelText('Order') as HTMLInputElement;
    expect(orderInput.value).toBe('1');

    fireEvent.change(nameInput, { target: { value: 'Beginner Updated' } });

    server.use(
      http.get('*/levels', () =>
        HttpResponse.json({ levels: [{ _id: 'level-1', name: 'Beginner Updated', order: 1 }] })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedPayload).toEqual({ name: 'Beginner Updated', order: 1 });
    });

    expect(await screen.findByText('Beginner Updated')).toBeInTheDocument();
  });

  it('deletes a level (happy path) and removes the row optimistically', async () => {
    render(<LevelsPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('level-1'));
    await waitFor(() => expect(screen.queryByText('Beginner')).not.toBeInTheDocument());
  });

  it('shows a "Cannot Delete" dialog with the backend 409 message when delete is blocked', async () => {
    server.use(
      http.delete('*/levels/:id', () =>
        HttpResponse.json({ message: 'Cannot delete: a price is configured for this level.' }, { status: 409 })
      )
    );

    render(<LevelsPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Cannot Delete')).toBeInTheDocument();
    expect(screen.getByText('Cannot delete: a price is configured for this level.')).toBeInTheDocument();
  });

  it('shows a dialog error when create fails', async () => {
    server.use(http.post('*/levels', () => HttpResponse.json({ message: 'Failed to create level.' }, { status: 500 })));

    render(<LevelsPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /add level/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Advanced' } });
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Failed to create level.')).toBeInTheDocument();
  });
});
