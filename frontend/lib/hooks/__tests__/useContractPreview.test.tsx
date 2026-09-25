import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  CONTRACT_PREVIEW_DEBOUNCE_MS,
  packRowsFromPacks,
  useContractPreview,
  type PackEditorRow,
} from '../useContractPreview';
import PackEditor from '../../../app/components/admin/PackEditor/PackEditor';
import { sessionPricesLabel } from '../../privateLessons';
import type { ContractPreview, PackQuoteRow, PrivateLessonPack, PrivateLessonPackDraft } from '../../types';

// docs/plans/coach-pack-pricing-plan.md D9a / §8 V6–V7 — the contract
// editor's one preview: lesson prices under the rate, a status line per
// pack, and the Save gate.

const SAVED_PACK: PrivateLessonPack = { _id: 'pack-1', sessionDurationMinutes: 30, quantity: 10, price: 300 };

// Server-verbatim regression guard (docs/design-system.md anti-pattern 10):
// these figures deliberately do NOT follow from $65/hr (that would be 30 min
// $32.50, and $30.00 per lesson · saves $25.00 (8%) for the pack). Any
// client-side arithmetic would render different numbers.
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
const ODD_SESSION_PRICES = [
  { durationMinutes: 30, price: 33.33 },
  { durationMinutes: 60, price: 66.66 },
];

const REFUSED = '10 × 30 min: price must be between $162.50 and $324.99';

interface PreviewRequest {
  studentBillingRate: number;
  sessionDurationMinutes: number | null;
  packs: PrivateLessonPackDraft[];
  coachId?: string;
}

let previewRequests: PreviewRequest[] = [];
let respond: (body: PreviewRequest) => ContractPreview = (body) => ({
  sessionPrices: ODD_SESSION_PRICES,
  packs: body.packs.map(() => ODD_QUOTE),
});

const server = setupServer(
  http.post('*/coach-contracts/preview', async ({ request }) => {
    const body = (await request.json()) as PreviewRequest;
    previewRequests.push(body);
    return HttpResponse.json(respond(body));
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  previewRequests = [];
  respond = (body) => ({ sessionPrices: ODD_SESSION_PRICES, packs: body.packs.map(() => ODD_QUOTE) });
});
afterAll(() => server.close());

// The real hook driving the real PackEditor, the way the contract dialog
// does; the lesson prices and canSave are rendered so tests read the DOM.
function Harness({ initial, rate = 65, coachId }: { initial: PackEditorRow[]; rate?: number | null; coachId?: string }) {
  const [rows, setRows] = useState(initial);
  const preview = useContractPreview({ studentBillingRate: rate, sessionDurationMinutes: 60, rows, coachId });
  return (
    <>
      {preview.sessionPrices ? <p>{sessionPricesLabel(preview.sessionPrices)}</p> : null}
      <PackEditor rows={rows} onChange={setRows} statusFor={preview.statusFor} />
      <output data-testid="can-save">{String(preview.canSave)}</output>
    </>
  );
}

describe('useContractPreview', () => {
  it('renders the lesson prices and each pack preview verbatim from the backend — never recomputed', async () => {
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} coachId="coach-1" />);

    expect(await screen.findByText('$31.11 per lesson · saves $44.44 (13%)')).toBeInTheDocument();
    expect(screen.getByText('Lesson prices: 30 min $33.33 · 60 min $66.66')).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('true');
    // Pack ids are never sent: an edit always makes a new version with new packs.
    expect(previewRequests).toEqual([
      {
        studentBillingRate: 65,
        sessionDurationMinutes: 60,
        packs: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
        coachId: 'coach-1',
      },
    ]);
  });

  it('shows lesson prices with no packs at all', async () => {
    render(<Harness initial={[]} />);

    expect(await screen.findByText('Lesson prices: 30 min $33.33 · 60 min $66.66')).toBeInTheDocument();
    expect(previewRequests).toEqual([{ studentBillingRate: 65, sessionDurationMinutes: 60, packs: [] }]);
  });

  it("shows the backend's refusal message and blocks saving while a pack is out of the band", async () => {
    respond = (body) => ({
      sessionPrices: ODD_SESSION_PRICES,
      packs: body.packs.map((pack) => ({ ...ODD_QUOTE, ...pack, savings: 0, savingsPercent: 0, error: REFUSED })),
    });
    render(<Harness initial={packRowsFromPacks([{ ...SAVED_PACK, price: 325 }])} />);

    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('false');
  });

  it('does not block saving when the preview itself fails — the save is the rule', async () => {
    server.use(http.post('*/coach-contracts/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} />);

    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument();
    expect(screen.getByTestId('can-save')).toHaveTextContent('true');
    expect(screen.queryByText(/lesson prices/i)).not.toBeInTheDocument();
  });

  it('blocks saving while a row is incomplete, and never sends it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await screen.findByText(/lesson prices/i);

    await user.click(screen.getByRole('button', { name: /add pack/i }));

    expect(screen.getByText(/fill in the lesson length, sessions and price/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('can-save')).toHaveTextContent('false'));
    expect(previewRequests.every((request) => request.packs.length === 0)).toBe(true);
  });

  it('asks for the hourly rate before previewing, and sends nothing', async () => {
    render(<Harness initial={packRowsFromPacks([SAVED_PACK])} rate={null} />);

    expect(screen.getByText(/set the hourly rate/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('can-save')).toHaveTextContent('true'));
    expect(previewRequests).toEqual([]);
  });

  // Only setTimeout/clearTimeout are faked (what the debounce uses), so no
  // real time passes between keystrokes and the result can never depend on
  // how fast the machine types (docs/TESTING_STRATEGY.md). Everything else —
  // promises, MSW, the finder's polling — stays real; the clock goes back to
  // real before awaiting the network.
  describe('debounce', () => {
    afterEach(() => jest.useRealTimers());

    it('sends one preview request for a whole typed pack, not one per keystroke', async () => {
      render(<Harness initial={[]} />);
      await screen.findByText(/lesson prices/i);
      previewRequests = [];

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

      await user.click(screen.getByRole('button', { name: /add pack/i }));
      await user.type(screen.getByLabelText(/pack 1 lesson length/i), '30');
      await user.type(screen.getByLabelText(/pack 1 sessions/i), '10');
      await user.type(screen.getByLabelText(/pack 1 price/i), '300');

      // Still inside the debounce window: nothing sent yet.
      expect(previewRequests).toEqual([]);

      act(() => {
        jest.advanceTimersByTime(CONTRACT_PREVIEW_DEBOUNCE_MS);
      });
      jest.useRealTimers();

      expect(await screen.findByText('$31.11 per lesson · saves $44.44 (13%)')).toBeInTheDocument();
      expect(previewRequests).toEqual([
        {
          studentBillingRate: 65,
          sessionDurationMinutes: 60,
          packs: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
        },
      ]);
    });
  });
});
