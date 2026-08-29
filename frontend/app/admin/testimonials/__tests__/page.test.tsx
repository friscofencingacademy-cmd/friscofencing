import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import TestimonialsPage from '../page';

const EXISTING_TESTIMONIAL = {
  _id: 'test-1',
  quote: 'Training at FFA has helped me feel more confident and disciplined.',
  authorName: 'Steve',
  caption: 'More than a sport, an environment for growth',
  imageUrl: 'https://example.com/steve.jpg',
  isPublished: false,
  order: 1,
};

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let updatedId: string | null = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/testimonials', () => HttpResponse.json({ testimonials: [EXISTING_TESTIMONIAL] })),
  http.post('*/testimonials', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      {
        testimonial: {
          _id: 'test-2',
          quote: 'New quote.',
          authorName: 'New Author',
          isPublished: false,
          order: 0,
        },
      },
      { status: 201 }
    );
  }),
  http.put('*/testimonials/:id', async ({ request, params }) => {
    updatedPayload = await request.json();
    updatedId = params.id as string;
    return HttpResponse.json({
      testimonial: { ...EXISTING_TESTIMONIAL, isPublished: true },
    });
  }),
  http.delete('*/testimonials/:id', ({ params }) => {
    deletedId = params.id as string;
    return HttpResponse.json({ success: true });
  }),
  http.post('*/testimonials/upload-image', () =>
    HttpResponse.json({ imageUrl: 'https://blob.example.com/testimonials/uploaded.jpg' }, { status: 201 })
  )
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

describe('TestimonialsPage', () => {
  it('renders the existing testimonials table', async () => {
    render(<TestimonialsPage />);

    expect(await screen.findByText('Steve')).toBeInTheDocument();
    // The table truncates long quotes at 60 chars — asserting the prefix,
    // not the full string.
    expect(screen.getByText(/^Training at FFA has helped me feel more confident/)).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('creates a new testimonial via the Add Testimonial dialog, omitting blank optional fields', async () => {
    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /add testimonial/i }));

    fireEvent.change(screen.getByLabelText('Quote'), { target: { value: 'New quote.' } });
    fireEvent.change(screen.getByLabelText('Author Name'), { target: { value: 'New Author' } });

    server.use(
      http.get('*/testimonials', () =>
        HttpResponse.json({
          testimonials: [
            EXISTING_TESTIMONIAL,
            {
              _id: 'test-2',
              quote: 'New quote.',
              authorName: 'New Author',
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
        quote: 'New quote.',
        authorName: 'New Author',
        caption: undefined,
        imageUrl: undefined,
        isPublished: false,
        order: 0,
      });
    });

    expect(await screen.findByText('New Author')).toBeInTheDocument();
  });

  it('edits a testimonial, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /edit testimonial by steve/i }));

    expect((screen.getByLabelText('Author Name') as HTMLInputElement).value).toBe('Steve');
    expect((screen.getByLabelText('Caption') as HTMLInputElement).value).toBe(
      'More than a sport, an environment for growth'
    );

    fireEvent.click(screen.getByLabelText('Published'));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedId).toBe('test-1');
      expect(updatedPayload).toMatchObject({ isPublished: true, authorName: 'Steve' });
    });
  });

  it('requires quote and author name before saving', async () => {
    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /add testimonial/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Quote and author name are required.')).toBeInTheDocument();
    expect(createdPayload).toBeNull();
  });

  it('deletes a testimonial (happy path) and removes the row optimistically', async () => {
    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /delete testimonial by steve/i }));
    expect(
      screen.getByText(/delete the testimonial by "steve"\? this cannot be undone\./i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('test-1'));
    await waitFor(() => expect(screen.queryByText('Steve')).not.toBeInTheDocument());
  });

  it('uploads a selected image file and fills the Image URL field with the returned url', async () => {
    const user = userEvent.setup();
    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /add testimonial/i }));

    const file = new File(['fake-bytes'], 'steve.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Or upload a file:'), file);

    await waitFor(() => {
      expect((screen.getByLabelText('Image URL') as HTMLInputElement).value).toBe(
        'https://blob.example.com/testimonials/uploaded.jpg'
      );
    });
  });

  it('shows a dialog error and keeps the dialog open when create fails', async () => {
    server.use(
      http.post('*/testimonials', () =>
        HttpResponse.json({ message: 'Failed to create testimonial.' }, { status: 500 })
      )
    );

    render(<TestimonialsPage />);
    await screen.findByText('Steve');

    fireEvent.click(screen.getByRole('button', { name: /add testimonial/i }));
    fireEvent.change(screen.getByLabelText('Quote'), { target: { value: 'New quote.' } });
    fireEvent.change(screen.getByLabelText('Author Name'), { target: { value: 'New Author' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Failed to create testimonial.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });
});
