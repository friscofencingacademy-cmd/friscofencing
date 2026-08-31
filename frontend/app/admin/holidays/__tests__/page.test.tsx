import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import HolidaysPage from '../page';
import type { Holiday } from '../../../../lib/types';

const EXISTING_HOLIDAY: Holiday = {
  _id: 'holiday-1',
  name: 'Winter Break',
  startDate: '2026-12-24T00:00:00.000Z',
  endDate: '2026-12-26T00:00:00.000Z',
};

let createdPayload: unknown = null;
let updatedPayload: unknown = null;
let deletedId: string | null = null;

const server = setupServer(
  http.get('*/holidays', () => HttpResponse.json({ holidays: [EXISTING_HOLIDAY] })),
  http.post('*/holidays', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { holiday: { _id: 'holiday-2', name: 'Thanksgiving', startDate: '2026-11-26', endDate: '2026-11-27' } },
      { status: 201 }
    );
  }),
  http.put('*/holidays/:id', async ({ request }) => {
    updatedPayload = await request.json();
    return HttpResponse.json({
      holiday: { _id: 'holiday-1', name: 'Winter Holidays', startDate: '2026-12-24T00:00:00.000Z', endDate: '2026-12-26T00:00:00.000Z' },
    });
  }),
  http.delete('*/holidays/:id', ({ params }) => {
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

describe('HolidaysPage', () => {
  it('renders the existing holidays table, dates in the sentinel-safe UTC format', async () => {
    render(<HolidaysPage />);

    expect(await screen.findByText('Winter Break')).toBeInTheDocument();
    // formatDateOnly renders in UTC regardless of the test runner's local
    // timezone (docs/plans/utc-date-standard-plan.md) — Dec 24/26, 2026.
    expect(screen.getByText('Dec 24, 2026')).toBeInTheDocument();
    expect(screen.getByText('Dec 26, 2026')).toBeInTheDocument();
  });

  it('creates a new holiday with the exact YYYY-MM-DD payload', async () => {
    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /add holiday/i }));
    await user.type(screen.getByLabelText('Name'), 'Thanksgiving');
    // Native date inputs don't reliably accept userEvent.type in jsdom —
    // fireEvent.change is the established pattern for these (see
    // AddChildModal's "Date of Birth" field test).
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-11-26' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-11-27' } });

    server.use(
      http.get('*/holidays', () =>
        HttpResponse.json({
          holidays: [
            EXISTING_HOLIDAY,
            { _id: 'holiday-2', name: 'Thanksgiving', startDate: '2026-11-26T00:00:00.000Z', endDate: '2026-11-27T00:00:00.000Z' },
          ],
        })
      )
    );

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ name: 'Thanksgiving', startDate: '2026-11-26', endDate: '2026-11-27' });
    });

    expect(await screen.findByText('Thanksgiving')).toBeInTheDocument();
  });

  it('edits a holiday, prefilling the date inputs from the sentinel ISO strings, and sends the exact PUT payload', async () => {
    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /edit winter break/i }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Winter Break');
    expect((screen.getByLabelText('Start Date') as HTMLInputElement).value).toBe('2026-12-24');
    expect((screen.getByLabelText('End Date') as HTMLInputElement).value).toBe('2026-12-26');

    fireEvent.change(nameInput, { target: { value: 'Winter Holidays' } });

    server.use(
      http.get('*/holidays', () =>
        HttpResponse.json({
          holidays: [{ _id: 'holiday-1', name: 'Winter Holidays', startDate: '2026-12-24T00:00:00.000Z', endDate: '2026-12-26T00:00:00.000Z' }],
        })
      )
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updatedPayload).toEqual({ name: 'Winter Holidays', startDate: '2026-12-24', endDate: '2026-12-26' });
    });

    expect(await screen.findByText('Winter Holidays')).toBeInTheDocument();
  });

  it('deletes a holiday (happy path) and removes the row optimistically', async () => {
    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /delete winter break/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletedId).toBe('holiday-1'));
    await waitFor(() => expect(screen.queryByText('Winter Break')).not.toBeInTheDocument());
  });

  it('shows a "Cannot Delete" state with the backend 409 message when overlap/reference blocks a save, without crashing', async () => {
    server.use(
      http.put('*/holidays/:id', () => HttpResponse.json({ message: 'Holiday overlaps with: Spring Break' }, { status: 409 }))
    );

    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /edit winter break/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Holiday overlaps with: Spring Break')).toBeInTheDocument();
    // The dialog stays open — the mutation failed without throwing into React.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows an inline error and does not crash when create fails', async () => {
    server.use(http.post('*/holidays', () => HttpResponse.json({ message: 'Failed to create holiday.' }, { status: 500 })));

    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /add holiday/i }));
    await user.type(screen.getByLabelText('Name'), 'Thanksgiving');
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-11-26' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-11-27' } });
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Failed to create holiday.')).toBeInTheDocument();
  });

  it('requires name, start date, and end date before saving', async () => {
    const user = userEvent.setup();
    render(<HolidaysPage />);
    await screen.findByText('Winter Break');

    await user.click(screen.getByRole('button', { name: /add holiday/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/all required/i)).toBeInTheDocument();
    expect(createdPayload).toBeNull();
  });
});
