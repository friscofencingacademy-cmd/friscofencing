import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import LocationsPage from '../page';

const EXISTING_LOCATION = {
  _id: 'loc-1',
  name: 'Frisco HQ',
  address: '123 Main St',
  timezone: 'America/Chicago',
};

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let updatedId: string | null = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/locations', () => HttpResponse.json({ locations: [EXISTING_LOCATION] })),
  http.post('*/locations', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { location: { _id: 'loc-2', name: 'New Salle', address: '789 Oak Ave', timezone: 'America/Chicago' } },
      { status: 201 }
    );
  }),
  http.put('*/locations/:id', async ({ request, params }) => {
    updatedPayload = await request.json();
    updatedId = params.id as string;
    return HttpResponse.json({
      location: { _id: params.id, name: 'Frisco HQ Updated', address: '123 Main St', timezone: 'America/Chicago' },
    });
  }),
  http.delete('*/locations/:id', ({ params }) => {
    deletedId = params.id as string;
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  createdPayload = null;
  updatedPayload = null;
  updatedId = null;
  deletedId = null;
});
afterAll(() => server.close());

describe('LocationsPage', () => {
  it('renders the existing locations table', async () => {
    render(<LocationsPage />);

    expect(await screen.findByText('Frisco HQ')).toBeInTheDocument();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('creates a new location via the Add Location dialog with the exact payload', async () => {
    render(<LocationsPage />);
    await screen.findByText('Frisco HQ');

    fireEvent.click(screen.getByRole('button', { name: /add location/i }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Salle' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '789 Oak Ave' } });

    server.use(
      http.get('*/locations', () =>
        HttpResponse.json({
          locations: [EXISTING_LOCATION, { _id: 'loc-2', name: 'New Salle', address: '789 Oak Ave', timezone: 'America/Chicago' }],
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ name: 'New Salle', address: '789 Oak Ave', timezone: 'America/Chicago' });
    });

    expect(await screen.findByText('New Salle')).toBeInTheDocument();
  });

  it('edits a location, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<LocationsPage />);
    await screen.findByText('Frisco HQ');

    fireEvent.click(screen.getByRole('button', { name: /edit frisco hq/i }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Frisco HQ');

    fireEvent.change(nameInput, { target: { value: 'Frisco HQ Updated' } });

    server.use(
      http.get('*/locations', () =>
        HttpResponse.json({
          locations: [{ _id: 'loc-1', name: 'Frisco HQ Updated', address: '123 Main St', timezone: 'America/Chicago' }],
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedId).toBe('loc-1');
      expect(updatedPayload).toEqual({
        name: 'Frisco HQ Updated',
        address: '123 Main St',
        timezone: 'America/Chicago',
      });
    });

    expect(await screen.findByText('Frisco HQ Updated')).toBeInTheDocument();
  });

  it('deletes a location (happy path) and removes the row optimistically', async () => {
    render(<LocationsPage />);
    await screen.findByText('Frisco HQ');

    fireEvent.click(screen.getByRole('button', { name: /delete frisco hq/i }));
    expect(screen.getByText(/delete "frisco hq"\? this cannot be undone\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('loc-1'));
    await waitFor(() => expect(screen.queryByText('Frisco HQ')).not.toBeInTheDocument());
  });

  it('shows a "Cannot Delete" dialog with the backend 409 message when delete is blocked', async () => {
    server.use(
      http.delete('*/locations/:id', () =>
        HttpResponse.json({ message: 'Cannot delete: 1 class(es) reference this location.' }, { status: 409 })
      )
    );

    render(<LocationsPage />);
    await screen.findByText('Frisco HQ');

    fireEvent.click(screen.getByRole('button', { name: /delete frisco hq/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Cannot Delete')).toBeInTheDocument();
    expect(screen.getByText('Cannot delete: 1 class(es) reference this location.')).toBeInTheDocument();

    // The row must still be present — nothing was actually deleted.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.getByText('Frisco HQ')).toBeInTheDocument();
  });

  it('shows a dialog error and keeps the dialog open when create fails', async () => {
    server.use(
      http.post('*/locations', () => HttpResponse.json({ message: 'Failed to create location.' }, { status: 500 }))
    );

    render(<LocationsPage />);
    await screen.findByText('Frisco HQ');

    fireEvent.click(screen.getByRole('button', { name: /add location/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Salle' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '789 Oak Ave' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Failed to create location.')).toBeInTheDocument();
    // Dialog stays open — the Create button is still visible.
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });
});
