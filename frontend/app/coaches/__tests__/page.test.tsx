import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import CoachesPage from '../page';
import { AuthProvider } from '../../context/AuthContext';

const COACH_A = { name: 'Jane Smith', title: 'Head Coach', body: 'Body A.', bullets: [] };
const COACH_B = { name: 'Sam Lee', title: 'Assistant Coach', body: 'Body B.', bullets: [] };

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [COACH_A, COACH_B] }))
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
  it('renders every published coach spotlight', async () => {
    renderPage();

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
  });

  it('shows the empty state when no coach profiles are published', async () => {
    server.use(http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [] })));

    renderPage();

    expect(
      await screen.findByText(/no coach profiles are published yet/i)
    ).toBeInTheDocument();
  });
});
