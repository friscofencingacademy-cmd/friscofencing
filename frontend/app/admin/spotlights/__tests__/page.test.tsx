import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import SpotlightsPage from '../page';

const EXISTING_SPOTLIGHT = {
  _id: 'spot-1',
  type: 'coach',
  name: 'Jane Smith',
  title: 'Head Coach',
  body: 'Jane has coached for 15 years.',
  bullets: ['NCAA fencer', 'USFA certified'],
  imageUrl: 'https://example.com/jane.jpg',
  isPublished: false,
  order: 1,
};

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let updatedId: string | null = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/spotlights', () => HttpResponse.json({ spotlights: [EXISTING_SPOTLIGHT] })),
  http.post('*/spotlights', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      {
        spotlight: {
          _id: 'spot-2',
          type: 'student',
          name: 'New Spotlight',
          bullets: [],
          isPublished: false,
          order: 0,
        },
      },
      { status: 201 }
    );
  }),
  http.put('*/spotlights/:id', async ({ request, params }) => {
    updatedPayload = await request.json();
    updatedId = params.id as string;
    return HttpResponse.json({
      spotlight: { ...EXISTING_SPOTLIGHT, isPublished: true },
    });
  }),
  http.delete('*/spotlights/:id', ({ params }) => {
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

describe('SpotlightsPage', () => {
  it('renders the existing spotlights table', async () => {
    render(<SpotlightsPage />);

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Head Coach')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('creates a new spotlight via the Add Spotlight dialog, trimming empty bullets and omitting blank optional fields', async () => {
    render(<SpotlightsPage />);
    await screen.findByText('Jane Smith');

    fireEvent.click(screen.getByRole('button', { name: /add spotlight/i }));

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'student' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Spotlight' } });
    fireEvent.change(screen.getByLabelText('Bullet 1'), { target: { value: 'Only bullet' } });

    server.use(
      http.get('*/spotlights', () =>
        HttpResponse.json({
          spotlights: [
            EXISTING_SPOTLIGHT,
            {
              _id: 'spot-2',
              type: 'student',
              name: 'New Spotlight',
              bullets: ['Only bullet'],
              isPublished: false,
              order: 0,
            },
          ],
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({
        type: 'student',
        name: 'New Spotlight',
        title: undefined,
        body: undefined,
        bullets: ['Only bullet'],
        imageUrl: undefined,
        isPublished: false,
        order: 0,
      });
    });

    expect(await screen.findByText('New Spotlight')).toBeInTheDocument();
  });

  it('edits a spotlight, prefilling the dialog (including bullets) and sending the exact PUT payload', async () => {
    render(<SpotlightsPage />);
    await screen.findByText('Jane Smith');

    fireEvent.click(screen.getByRole('button', { name: /edit jane smith/i }));

    expect((screen.getByLabelText('Bullet 1') as HTMLInputElement).value).toBe('NCAA fencer');
    expect((screen.getByLabelText('Bullet 2') as HTMLInputElement).value).toBe('USFA certified');

    fireEvent.click(screen.getByLabelText('Published'));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedId).toBe('spot-1');
      expect(updatedPayload).toMatchObject({ isPublished: true, name: 'Jane Smith' });
    });
  });

  it('deletes a spotlight (happy path) and removes the row optimistically', async () => {
    render(<SpotlightsPage />);
    await screen.findByText('Jane Smith');

    fireEvent.click(screen.getByRole('button', { name: /delete jane smith/i }));
    expect(screen.getByText(/delete "jane smith"\? this cannot be undone\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('spot-1'));
    await waitFor(() => expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument());
  });

  it('shows a dialog error and keeps the dialog open when create fails', async () => {
    server.use(
      http.post('*/spotlights', () => HttpResponse.json({ message: 'Failed to create spotlight.' }, { status: 500 }))
    );

    render(<SpotlightsPage />);
    await screen.findByText('Jane Smith');

    fireEvent.click(screen.getByRole('button', { name: /add spotlight/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Spotlight' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Failed to create spotlight.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });
});
