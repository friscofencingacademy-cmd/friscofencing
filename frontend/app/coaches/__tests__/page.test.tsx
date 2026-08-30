import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CoachesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

const COACH_A = { name: 'Jane Smith', title: 'Head Coach', body: 'Body A.', bullets: [], imageUrl: 'https://example.com/jane.jpg' };
const COACH_B = { name: 'Sam Lee', title: 'Assistant Coach', body: 'Body B.', bullets: [] };
const LOCATION = { name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago', phone: '', email: '' };

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [COACH_A, COACH_B] })),
  // Fetched alongside spotlights (Promise.all) since Phase 2 added the
  // footer's location data — see docs/plans/wordpress-ui-alignment-plan.md.
  http.get('*/locations/public', () => HttpResponse.json({ locations: [LOCATION] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <CoachesPage />
    </AuthProvider>
  );
}

describe('CoachesPage', () => {
  it('renders the "Our Team" band with every published coach spotlight', async () => {
    renderPage();

    // The band's heading renders unconditionally (before the fetch
    // resolves) — findByText below is what actually waits for data.
    expect(screen.getByRole('heading', { name: 'Guided by Experience' })).toBeInTheDocument();
    // "Our Team" also appears as the public nav link — assert the eyebrow's
    // own occurrence, not a bare unique-text query.
    expect(screen.getAllByText('Our Team').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Head Coach')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getByText('Assistant Coach')).toBeInTheDocument();
  });

  it('shows the empty state when no coach profiles are published', async () => {
    server.use(http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [] })));

    renderPage();

    expect(
      await screen.findByText(/no coach profiles are published yet/i)
    ).toBeInTheDocument();
    // The band's own heading still renders — this is the page's own
    // dedicated content, not a home-page teaser that vanishes on empty.
    expect(screen.getByRole('heading', { name: 'Guided by Experience' })).toBeInTheDocument();
  });

  it('shows LoadError with a working retry on a failed fetch', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/spotlights/public', () =>
        HttpResponse.json({ message: 'Failed to list spotlights' }, { status: 500 })
      )
    );

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.use(http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [COACH_A] })));

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
  });
});
