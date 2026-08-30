import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PricesPage from '../page';
import type { Price } from '../../../../lib/types';

const EXISTING_LEVEL = { _id: 'level-1', name: 'Beginner' };
const ADVANCED_LEVEL = { _id: 'level-2', name: 'Advanced' };
// registrationFee omitted (null/undefined) — inherits the academy-wide
// default, exercised by the "Default" table marker test below.
const EXISTING_PRICE: Price = { _id: 'price-1', levelId: 'level-1', monthlyFee: 150 };

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
      // registrationFee left blank in the dialog -> sent as an explicit
      // null, meaning "inherit the academy-wide default"
      // (docs/plans/per-level-registration-fee-plan.md).
      expect(createdPayload).toEqual({ levelId: 'level-2', monthlyFee: 200, registrationFee: null });
    });

    expect(await screen.findByText('Advanced')).toBeInTheDocument();
  });

  it('edits a price, prefilling the dialog and sending the exact PUT payload', async () => {
    render(<PricesPage />);
    await screen.findByText('Beginner');

    fireEvent.click(screen.getByRole('button', { name: /edit beginner price/i }));

    const feeInput = screen.getByLabelText('Monthly Fee') as HTMLInputElement;
    expect(feeInput.value).toBe('150');

    const regFeeInput = screen.getByLabelText('Registration Fee') as HTMLInputElement;
    expect(regFeeInput.value).toBe('');

    fireEvent.change(feeInput, { target: { value: '175' } });

    server.use(
      http.get('*/prices', () =>
        HttpResponse.json({ prices: [{ _id: 'price-1', levelId: 'level-1', monthlyFee: 175 }] })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedPayload).toEqual({ levelId: 'level-1', monthlyFee: 175, registrationFee: null });
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

  // Per-level registration fee (docs/plans/per-level-registration-fee-plan.md)
  describe('registrationFee override', () => {
    it('renders the level\'s own registration fee when set, and a "Default" inherit marker when unset', async () => {
      const overriddenPrice: Price = { _id: 'price-2', levelId: 'level-2', monthlyFee: 200, registrationFee: 100 };
      server.use(http.get('*/prices', () => HttpResponse.json({ prices: [EXISTING_PRICE, overriddenPrice] })));

      render(<PricesPage />);
      await screen.findByText('Beginner');

      const table = screen.getByRole('table');
      expect(within(table).getByText('Default')).toBeInTheDocument();
      expect(within(table).getByText('100')).toBeInTheDocument();
    });

    it('creates a price with an explicit registration fee override', async () => {
      const user = userEvent.setup();
      render(<PricesPage />);
      await screen.findByText('Beginner');

      await user.click(screen.getByRole('button', { name: /add price/i }));
      await user.selectOptions(screen.getByLabelText('Level'), 'level-2');
      await user.type(screen.getByLabelText('Monthly Fee'), '200');
      await user.type(screen.getByLabelText('Registration Fee'), '100');

      server.use(
        http.get('*/prices', () =>
          HttpResponse.json({
            prices: [EXISTING_PRICE, { _id: 'price-2', levelId: 'level-2', monthlyFee: 200, registrationFee: 100 }],
          })
        )
      );

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(createdPayload).toEqual({ levelId: 'level-2', monthlyFee: 200, registrationFee: 100 });
      });
    });

    it('sets a registration fee override to an explicit 0 (distinct from blank/inherit)', async () => {
      const user = userEvent.setup();
      render(<PricesPage />);
      await screen.findByText('Beginner');

      await user.click(screen.getByRole('button', { name: /edit beginner price/i }));
      await user.type(screen.getByLabelText('Registration Fee'), '0');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(updatedPayload).toEqual({ levelId: 'level-1', monthlyFee: 150, registrationFee: 0 });
      });
    });

    it('shows an inline error and does not crash when saving a price fails', async () => {
      server.use(
        http.post('*/prices', () => HttpResponse.json({ message: 'Failed to create price.' }, { status: 500 }))
      );

      const user = userEvent.setup();
      render(<PricesPage />);
      await screen.findByText('Beginner');

      await user.click(screen.getByRole('button', { name: /add price/i }));
      await user.selectOptions(screen.getByLabelText('Level'), 'level-2');
      await user.type(screen.getByLabelText('Monthly Fee'), '200');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      expect(await screen.findByText('Failed to create price.')).toBeInTheDocument();
      // The dialog stays open with the entered values intact — the
      // mutation failed without throwing into React.
      expect(screen.getByLabelText('Monthly Fee')).toHaveValue(200);
    });
  });

  // The actual owner-reported bug (docs/plans/shared-modal-component-plan.md)
  // — a misclick outside the dialog used to close it and silently discard
  // whatever had been typed in.
  describe('backdrop click regression (shared-modal-component-plan.md)', () => {
    it('does not close the dialog or lose typed data when the backdrop is clicked', async () => {
      const user = userEvent.setup();
      render(<PricesPage />);
      await screen.findByText('Beginner');

      await user.click(screen.getByRole('button', { name: /add price/i }));
      await user.selectOptions(screen.getByLabelText('Level'), 'level-2');
      await user.type(screen.getByLabelText('Monthly Fee'), '200');

      const dialog = screen.getByRole('dialog');
      const overlay = dialog.parentElement as HTMLElement;
      await user.click(overlay);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText('Monthly Fee')).toHaveValue(200);
    });
  });
});
