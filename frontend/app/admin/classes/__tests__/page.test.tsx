import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ClassesPage from '../page';

const LEVEL = { _id: 'level-1', name: 'Beginner' };
const LOCATION = { _id: 'loc-1', name: 'Frisco HQ' };
const EXISTING_CLASS = { _id: 'class-1', name: 'Beginner Foil', levelId: 'level-1', locationId: 'loc-1', capacity: 10 };

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [EXISTING_CLASS] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [LEVEL] })),
  http.get('*/locations', () => HttpResponse.json({ locations: [LOCATION] })),
  http.post('*/group-classes', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { groupClass: { _id: 'class-2', name: 'Advanced Epee', levelId: 'level-1', locationId: 'loc-1', capacity: 8 } },
      { status: 201 }
    );
  }),
  http.put('*/group-classes/:id', async ({ request }) => {
    updatedPayload = await request.json();
    return HttpResponse.json({
      groupClass: { _id: 'class-1', name: 'Beginner Foil Updated', levelId: 'level-1', locationId: 'loc-1', capacity: 12 },
    });
  }),
  http.delete('*/group-classes/:id', ({ params }) => {
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

describe('ClassesPage', () => {
  it('renders the existing classes table with resolved level/location names', async () => {
    render(<ClassesPage />);

    await screen.findByText('Beginner Foil');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Beginner Foil')).toBeInTheDocument();
    expect(within(table).getByText('Beginner')).toBeInTheDocument();
    expect(within(table).getByText('Frisco HQ')).toBeInTheDocument();
  });

  it('creates a new class with the exact payload', async () => {
    render(<ClassesPage />);
    await screen.findByText('Beginner Foil');

    fireEvent.click(screen.getByRole('button', { name: /add class/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Advanced Epee' } });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'level-1' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'loc-1' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '8' } });

    server.use(
      http.get('*/group-classes', () =>
        HttpResponse.json({
          groupClasses: [EXISTING_CLASS, { _id: 'class-2', name: 'Advanced Epee', levelId: 'level-1', locationId: 'loc-1', capacity: 8 }],
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ name: 'Advanced Epee', levelId: 'level-1', locationId: 'loc-1', capacity: 8 });
    });

    expect(await screen.findByText('Advanced Epee')).toBeInTheDocument();
  });

  it('edits a class, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<ClassesPage />);
    await screen.findByText('Beginner Foil');

    fireEvent.click(screen.getByRole('button', { name: /edit beginner foil/i }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Beginner Foil');

    fireEvent.change(nameInput, { target: { value: 'Beginner Foil Updated' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '12' } });

    server.use(
      http.get('*/group-classes', () =>
        HttpResponse.json({
          groupClasses: [{ _id: 'class-1', name: 'Beginner Foil Updated', levelId: 'level-1', locationId: 'loc-1', capacity: 12 }],
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedPayload).toEqual({
        name: 'Beginner Foil Updated',
        levelId: 'level-1',
        locationId: 'loc-1',
        capacity: 12,
      });
    });

    expect(await screen.findByText('Beginner Foil Updated')).toBeInTheDocument();
  });

  it('deletes a class (happy path) and removes the row optimistically', async () => {
    render(<ClassesPage />);
    await screen.findByText('Beginner Foil');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner foil/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('class-1'));
    await waitFor(() => expect(screen.queryByText('Beginner Foil')).not.toBeInTheDocument());
  });

  it('shows a "Cannot Delete" dialog with the backend 409 message when delete is blocked by a schedule', async () => {
    server.use(
      http.delete('*/group-classes/:id', () =>
        HttpResponse.json({ message: 'Cannot delete: 1 schedule(s) reference this class.' }, { status: 409 })
      )
    );

    render(<ClassesPage />);
    await screen.findByText('Beginner Foil');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner foil/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Cannot Delete')).toBeInTheDocument();
    expect(screen.getByText('Cannot delete: 1 schedule(s) reference this class.')).toBeInTheDocument();
  });
});
