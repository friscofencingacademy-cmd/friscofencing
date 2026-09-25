import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PackEditor, { PACK_PREVIEW_DEBOUNCE_MS, packRowsFromPacks, type PackEditorRow } from '../PackEditor';
import type { PackQuoteRow, PrivateLessonPack, PrivateLessonPackDraft } from '../../../../../lib/types';

// docs/plans/coach-pack-pricing-plan.md D9a/D14 e — the one pack editor.

const SAVED_PACK: PrivateLessonPack = { _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 };

// Server-verbatim regression guard (docs/design-system.md anti-pattern 10):
// these figures deliberately do NOT follow from 10 x $32.50 vs $300 (that
// would be $30.00 per lesson, saves $25.00, 8%). Any client-side arithmetic
// would render different numbers than the ones asserted below.
const ODD_QUOTE: PackQuoteRow = {
  sessionDurationMinutes: 30,
  quantity: 10,
  price: 300,
  perLessonPrice: 31.11,
  subtotal: 333.33,
  savings: 44.44,
  savingsPercent: 13,
  allowedRange: { min: 150, max: 333.32 },
  error: null,
};

const REFUSED = '10 × 30 min: price must be between $162.50 and $324.99';

let quoteRequests: Array<{ studentBillingRate: number; packs: PrivateLessonPackDraft[] }> = [];
let respond: (packs: PrivateLessonPackDraft[]) => PackQuoteRow[] = (packs) => packs.map(() => ODD_QUOTE);

const server = setupServer(
  http.post('*/coach-contracts/pack-quotes', async ({ request }) => {
    const body = (await request.json()) as { studentBillingRate: number; packs: PrivateLessonPackDraft[] };
    quoteRequests.push(body);
    return HttpResponse.json({ quotes: respond(body.packs) });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  quoteRequests = [];
  respond = (packs) => packs.map(() => ODD_QUOTE);
});
afterAll(() => server.close());

// The real component with its rows held the way a dialog holds them; the
// latest canSave is written into the DOM so a test reads rendered output.
function Harness({ initial, rate = 65 }: { initial: PackEditorRow[]; rate?: number | null }) {
  const [rows, setRows] = useState(initial);
  const [canSave, setCanSave] = useState<boolean | null>(null);
  return (
    <>
      <PackEditor studentBillingRate={rate} rows={rows} onChange={setRows} onCanSaveChange={setCanSave} />
      <output data-testid="can-save">{String(canSave)}</output>
    </>
  );
}

describe('PackEditor', () => {
  it('renders the backend preview verbatim — never recomputed', async () => {
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} />);

    expect(await screen.findByText('$31.11 per lesson · saves $44.44 (13%)')).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('true');
    expect(quoteRequests).toEqual([
      { studentBillingRate: 65, packs: [{ _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 }] },
    ]);
  });

  it("shows the backend's refusal message and blocks saving while a pack is out of the band", async () => {
    respond = (packs) =>
      packs.map((pack) => ({ ...ODD_QUOTE, ...pack, perLessonPrice: 32.5, savings: 0, savingsPercent: 0, error: REFUSED }));
    render(<Harness initial={packRowsFromPacks([{ ...SAVED_PACK, price: 325 }])} />);

    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('false');
  });

  it('does not block saving when the preview itself fails — the save is the rule', async () => {
    server.use(
      http.post('*/coach-contracts/pack-quotes', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} />);

    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('true');
  });

  it('blocks saving while a row is incomplete, and requests no preview for it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);

    await user.click(screen.getByRole('button', { name: /add pack/i }));

    expect(screen.getByText(/fill in the lesson length, sessions and price/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('can-save')).toHaveTextContent('false'));
    expect(quoteRequests).toEqual([]);
  });

  // Only setTimeout/clearTimeout are faked (what the debounce uses), so no
  // real time passes between keystrokes and the result can never depend on
  // how fast the machine types (docs/TESTING_STRATEGY.md). Everything else —
  // promises, MSW, the finder's polling — stays real; the clock goes back to
  // real before awaiting the network.
  describe('debounce', () => {
    afterEach(() => jest.useRealTimers());

    it('sends one preview request for a whole typed price, not one per keystroke', async () => {
      jest.useFakeTimers({
        doNotFake: [
          'Date',
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
        ],
      });
      const user = userEvent.setup({ delay: null });
      render(<Harness initial={[]} />);

      await user.click(screen.getByRole('button', { name: /add pack/i }));
      await user.type(screen.getByLabelText(/pack 1 lesson length/i), '30');
      await user.type(screen.getByLabelText(/pack 1 sessions/i), '10');
      await user.type(screen.getByLabelText(/pack 1 price/i), '300');

      // Still inside the debounce window: nothing sent yet.
      expect(quoteRequests).toEqual([]);

      act(() => {
        jest.advanceTimersByTime(PACK_PREVIEW_DEBOUNCE_MS);
      });
      jest.useRealTimers();

      expect(await screen.findByText('$31.11 per lesson · saves $44.44 (13%)')).toBeInTheDocument();
      expect(quoteRequests).toEqual([
        { studentBillingRate: 65, packs: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }] },
      ]);
    });
  });

  it('asks for the hourly rate before previewing', async () => {
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} rate={null} />);

    expect(screen.getByText(/set the hourly rate/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('can-save')).toHaveTextContent('true'));
    expect(quoteRequests).toEqual([]);
  });

  it('removes a row', async () => {
    const user = userEvent.setup();
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} />);

    await user.click(screen.getByRole('button', { name: /remove pack 1/i }));

    expect(screen.queryByLabelText(/pack 1 price/i)).not.toBeInTheDocument();
  });
});
