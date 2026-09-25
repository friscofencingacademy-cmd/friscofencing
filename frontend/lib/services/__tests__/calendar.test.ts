import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { fetchAdminCalendar, fetchMyCalendar, fetchPublicCalendar } from '../calendar';
import type { CalendarQuery, CalendarResponse } from '../../types';

const RESPONSE: CalendarResponse = {
  from: '2026-09-27',
  to: '2026-11-07',
  horizonTo: '2026-12-06',
  events: [],
  coaches: [{ id: '64b0000000000000000000c1', name: 'Dana Cole' }],
};

let received: Record<string, string> = {};

function capture(request: Request) {
  received = Object.fromEntries(new URL(request.url).searchParams.entries());
  return HttpResponse.json(RESPONSE);
}

const server = setupServer(
  http.get('*/calendar/public', ({ request }) => capture(request)),
  http.get('*/calendar/mine', ({ request }) => capture(request)),
  http.get('*/calendar', ({ request }) => capture(request))
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  received = {};
});
afterAll(() => server.close());

const FETCHERS: [string, string, (query: CalendarQuery) => Promise<CalendarResponse>][] = [
  ['fetchPublicCalendar', '*/calendar/public', fetchPublicCalendar],
  ['fetchMyCalendar', '*/calendar/mine', fetchMyCalendar],
  ['fetchAdminCalendar', '*/calendar', fetchAdminCalendar],
];

// docs/TESTING_STRATEGY.md's error-handling contract: queries throw.
describe('calendar service', () => {
  it.each(FETCHERS)('%s resolves the server response verbatim and sends every filter', async (_name, _url, fetcher) => {
    const result = await fetcher({ from: '2026-09-27', to: '2026-11-07', coachId: '64b0000000000000000000c1', type: 'private' });

    expect(result).toEqual(RESPONSE);
    expect(received).toEqual({ from: '2026-09-27', to: '2026-11-07', coachId: '64b0000000000000000000c1', type: 'private' });
  });

  it.each(FETCHERS)('%s leaves out an unset coach and the default type', async (_name, _url, fetcher) => {
    await fetcher({ from: '2026-09-27', to: '2026-11-07', coachId: null, type: 'all' });

    expect(received).toEqual({ from: '2026-09-27', to: '2026-11-07' });
  });

  it.each(FETCHERS)('%s rejects on a server error', async (_name, url, fetcher) => {
    server.use(http.get(url, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    await expect(fetcher({ from: '2026-09-27', to: '2026-11-07', coachId: null, type: 'all' })).rejects.toBeTruthy();
  });
});
