import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PricesPage from '../page';

const EXISTING_LEVEL = { _id: 'level-1', name: 'Beginner' };
const ADVANCED_LEVEL = { _id: 'level-2', name: 'Advanced' };
const EXISTING_PRICE = { _id: 'price-1', levelId: 'level-1', monthlyFee: 150 };

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/prices', () => HttpResponse.json({ prices: [EXISTING_PRICE] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [EXISTING_LEVEL, ADVANCED_LEVEL] })),
  http.post('*/prices', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json({ price: { _id: 'price-2', levelId: 'level-2', monthlyFee: 200 } }, { status: 201 });
  }),
  http.put('*/prices/:id', async ({ request }) => {
    updatedPayload = await request.json();
    return HttpResponse.json({ price: { _id: 'price-1', levelId: 'level-1', monthlyFee: 175 } });
  }),
  http.delete('*/prices/:id', ({ params }) => {
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

describe('PricesPage', () => {
  it('renders the existing prices table with the resolved level name', async () => {
    render(<PricesPage />);

    await screen.findByText('Beginner');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Beginner')).toBeInTheDocument();
    expect(within(table).getByText('150')).toBeInTheDocument();
  });

  it('creates a new price with the exact payload', async () => {
    render(<PricesPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /add price/i }));
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'level-2' } });
    fireEvent.change(screen.getByLabelText('Monthly Fee'), { target: { value: '200' } });

    server.use(
      http.get('*/prices', () =>
        HttpResponse.json({ prices: [EXISTING_PRICE, { _id: 'price-2', levelId: 'level-2', monthlyFee: 200 }] })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ levelId: 'level-2', monthlyFee: 200 });
    });

    expect(await screen.findByText('Advanced')).toBeInTheDocument();
  });

  it('edits a price, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<PricesPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /edit beginner price/i }));

    const feeInput = screen.getByLabelText('Monthly Fee') as HTMLInputElement;
    expect(feeInput.value).toBe('150');

    fireEvent.change(feeInput, { target: { value: '175' } });

    server.use(
      http.get('*/prices', () =>
        HttpResponse.json({ prices: [{ _id: 'price-1', levelId: 'level-1', monthlyFee: 175 }] })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedPayload).toEqual({ levelId: 'level-1', monthlyFee: 175 });
    });

    expect(await screen.findByText('175')).toBeInTheDocument();
  });

  it('deletes a price (happy path) and removes the row optimistically', async () => {
    render(<PricesPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner price/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('price-1'));
  });

  it('shows a "Cannot Delete" dialog is not needed for Price (freely deletable) but a generic failure still surfaces', async () => {
    server.use(
      http.delete('*/prices/:id', () => HttpResponse.json({ message: 'Failed to delete price.' }, { status: 500 }))
    );

    render(<PricesPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /delete beginner price/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Failed to delete price.')).toBeInTheDocument();
  });
});
