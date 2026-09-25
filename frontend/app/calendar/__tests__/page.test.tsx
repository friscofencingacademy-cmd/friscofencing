import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CalendarPage from '../page';
import { AuthProvider } from '../../context/AuthContext';
import type { CalendarEvent, CalendarResponse } from '../../../lib/types';

// The public calendar page (docs/plans/calendar-view-plan.md §2.4): a real
// MSW round trip to /calendar/public, URL-held state, and links into the
// existing booking flows.

const replaceMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

// "Today" is computed from the clock, so the clock is frozen (docs/
// TESTING_STRATEGY.md's date rules): Monday Oct 5 2026, 9:00 AM Central.
// Only Date is swapped — jest fake timers hang MSW + Testing Library's
// polling (see app/parent/register/__tests__/page.test.tsx).
const FIXED_NOW = new Date('2026-10-05T14:00:00.000Z');
const RealDate = global.Date;

class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(FIXED_NOW.getTime());
    } else {
      // @ts-expect-error — every call here passes zero args ("now") or one
      // ISO string / number, both handled by the base constructor.
      super(...args);
    }
  }

  static now(): number {
    return FIXED_NOW.getTime();
  }
}

const COACH_ID = '64b0000000000000000000c1';

const OPEN_SLOT: CalendarEvent = {
  id: 'private-open:rule-1:2026-10-06',
  kind: 'private-open',
  day: '2026-10-06',
  startsAt: '2026-10-06T21:30:00.000Z',
  endsAt: '2026-10-06T22:00:00.000Z',
  title: 'Private lesson — 30 min',
  coach: { id: COACH_ID, name: 'Dana Cole' },
  locationName: null,
  levelName: null,
  durationMinutes: 30,
  scheduleId: 'rule-1',
  sessionId: null,
  price: 32.5,
  mine: false,
  students: [],
  isHoliday: false,
  holidayName: null,
};

const CLASS: CalendarEvent = {
  ...OPEN_SLOT,
  id: 'group:session-1',
  kind: 'group',
  day: '2026-10-07',
  startsAt: '2026-10-07T21:00:00.000Z',
  endsAt: '2026-10-07T22:00:00.000Z',
  title: 'Beginner Foil',
  locationName: 'Frisco HQ',
  levelName: 'Beginner',
  scheduleId: 'schedule-1',
  sessionId: 'session-1',
  price: null,
};

const CALENDAR: CalendarResponse = {
  from: '2026-09-27',
  to: '2026-11-07',
  horizonTo: '2026-12-06',
  events: [OPEN_SLOT, CLASS],
  coaches: [{ id: COACH_ID, name: 'Dana Cole' }],
};

const PARENT_USER = { _id: 'parent-1', role: 'parent', firstName: 'Pat', lastName: 'Rivera', email: 'pat@example.com' };

let requests: Record<string, string>[] = [];
let authUser: unknown = null;

const server = setupServer(
  http.get('*/auth/me', () =>
    authUser ? HttpResponse.json({ user: authUser }) : HttpResponse.json({ message: 'unauthorized' }, { status: 401 })
  ),
  http.get('*/calendar/public', ({ request }) => {
    requests.push(Object.fromEntries(new URL(request.url).searchParams.entries()));
    return HttpResponse.json(CALENDAR);
  })
);

beforeAll(() => server.listen());
beforeEach(() => {
  global.Date = FrozenDate as DateConstructor;
});
afterEach(() => {
  server.resetHandlers();
  replaceMock.mockClear();
  mockSearchParams = new URLSearchParams();
  requests = [];
  authUser = null;
  global.Date = RealDate;
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <CalendarPage />
    </AuthProvider>
  );
}

function tuesdayCell() {
  return screen.getByRole('cell', { name: /Tuesday, October 6/ });
}

describe('CalendarPage', () => {
  it("requests this month's whole grid from the public calendar and draws it", async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    await within(await screen.findByRole('cell', { name: /Tuesday, October 6/ })).findByText('Open slot');
    expect(requests).toEqual([{ from: '2026-09-27', to: '2026-11-07' }]);
  });

  it('reads month, coach and type from the URL and sends them', async () => {
    mockSearchParams = new URLSearchParams(`month=2026-11&coach=${COACH_ID}&type=private`);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(requests[0]).toEqual({ from: '2026-11-01', to: '2026-12-12', coachId: COACH_ID, type: 'private' });
  });

  it('keeps every change in the URL, and refetches when the URL changes', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await within(await screen.findByRole('cell', { name: /Tuesday, October 6/ })).findByText('Open slot');

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(replaceMock).toHaveBeenLastCalledWith('/calendar?month=2026-11', { scroll: false });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Coach' }), 'Dana Cole');
    expect(replaceMock).toHaveBeenLastCalledWith(`/calendar?month=2026-10&coach=${COACH_ID}`, { scroll: false });

    // The router applies the new URL; the page follows it.
    mockSearchParams = new URLSearchParams(`month=2026-11&coach=${COACH_ID}`);
    rerender(
      <AuthProvider>
        <CalendarPage />
      </AuthProvider>
    );

    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    await screen.findByRole('cell', { name: /Tuesday, November 3/ });
    expect(requests[requests.length - 1]).toEqual({ from: '2026-11-01', to: '2026-12-12', coachId: COACH_ID });
  });

  it('sends a logged-out visitor to log in first, carrying the wizard link with the slot and its day', async () => {
    renderPage();

    const link = await within(await screen.findByRole('cell', { name: /Tuesday, October 6/ })).findByRole('link');
    expect(link).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/parent/register-private?slot=rule-1&day=2026-10-06')}`
    );
    expect(within(screen.getByRole('cell', { name: /Wednesday, October 7/ })).getByRole('link')).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/parent/book-trial')}`
    );
  });

  it('sends a logged-in parent straight into the booking wizard and book-trial', async () => {
    authUser = PARENT_USER;

    renderPage();

    await screen.findByRole('cell', { name: /Tuesday, October 6/ });
    expect(await within(tuesdayCell()).findByRole('link')).toHaveAttribute(
      'href',
      '/parent/register-private?slot=rule-1&day=2026-10-06'
    );
    expect(within(screen.getByRole('cell', { name: /Wednesday, October 7/ })).getByRole('link')).toHaveAttribute(
      'href',
      '/parent/book-trial'
    );
  });

  it('renders LoadError with a working retry on a failed load', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/calendar/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    server.use(http.get('*/calendar/public', () => HttpResponse.json(CALENDAR)));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    await within(await screen.findByRole('cell', { name: /Tuesday, October 6/ })).findByText('Open slot');
  });
});
