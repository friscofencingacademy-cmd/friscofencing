import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import HomePage from '../page';
import { AuthProvider } from '../context/AuthContext';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const BEGINNER = { name: 'Beginner', order: 1, monthlyFee: 120 };
const ADVANCED = { name: 'Advanced', order: 2, monthlyFee: 180 };
const LOCATION = { name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago' };

const COACH_A = {
  name: 'Jane Smith',
  title: 'Head Coach',
  body: 'Jane has coached for 15 years.',
  bullets: ['NCAA fencer', 'USFA certified'],
};

const COACH_B = { name: 'Sam Lee', title: 'Assistant Coach', body: '', bullets: [] };

const FEATURED_STUDENT = {
  name: 'Alex Doe',
  title: '2026 Regional Champion',
  body: 'Alex trains four days a week.',
  bullets: [],
};

function spotlightsHandler(coaches: unknown[] = [COACH_A, COACH_B], students: unknown[] = [FEATURED_STUDENT]) {
  return http.get('*/spotlights/public', ({ request }) => {
    const type = new URL(request.url).searchParams.get('type');

    if (type === 'coach') {
      return HttpResponse.json({ spotlights: coaches });
    }
    if (type === 'student') {
      return HttpResponse.json({ spotlights: students });
    }
    return HttpResponse.json({ message: 'type must be "coach" or "student"' }, { status: 400 });
  });
}

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/levels/public', () => HttpResponse.json({ levels: [BEGINNER, ADVANCED] })),
  http.get('*/locations/public', () => HttpResponse.json({ locations: [LOCATION] })),
  spotlightsHandler()
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  replaceMock.mockClear();
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <AuthProvider>
      <HomePage />
    </AuthProvider>
  );
}

describe('HomePage (logged out)', () => {
  it('renders the hero, steps, level grid, facility stats, closing CTA, and footer from real data', async () => {
    renderPage();

    expect(await screen.findByText('Olympic Fencing.')).toBeInTheDocument();
    expect(screen.getByText('Three steps to your first class.')).toBeInTheDocument();
    expect(screen.getByText('Create your free account')).toBeInTheDocument();
    expect(screen.getByText('Add your child')).toBeInTheDocument();
    expect(screen.getByText('Pick a free trial class')).toBeInTheDocument();

    expect(screen.getByText('A clear path for every stage')).toBeInTheDocument();
    expect(await screen.findByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('$120/month')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
    expect(screen.getByText('$180/month')).toBeInTheDocument();

    // FacilityBand — static, owner-authored stats (never backend data).
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5+')).toBeInTheDocument();
    expect(screen.getByText('7 Days')).toBeInTheDocument();

    expect(screen.getByText('Join Our Community')).toBeInTheDocument();
    expect(
      screen.getByText('The first class is free. It takes two minutes to book.')
    ).toBeInTheDocument();
    expect(screen.getByText('Frisco HQ · 123 Main St')).toBeInTheDocument();

    const trialLinks = screen.getAllByRole('link', { name: /take a trial class/i });
    expect(trialLinks.every((link) => link.getAttribute('href') === '/register')).toBe(true);
  });

  it('renders no Levels section when the backend returns none, instead of a placeholder', async () => {
    server.use(http.get('*/levels/public', () => HttpResponse.json({ levels: [] })));

    renderPage();

    await screen.findByText('Olympic Fencing.');

    expect(screen.queryByText(/\$\d+\/month/)).not.toBeInTheDocument();
  });

  it('renders every published coach in the team band, plus a link to /coaches, and the student spotlight with its eyebrow', async () => {
    renderPage();

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Head Coach')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getByText('Assistant Coach')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all coaches/i })).toHaveAttribute(
      'href',
      '/coaches'
    );

    expect(screen.getByText('Alex Doe')).toBeInTheDocument();
    expect(screen.getByText('Student Spotlight')).toBeInTheDocument();
  });

  it('renders neither the team band, nor the student spotlight section, when the backend has none published', async () => {
    server.use(http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [] })));

    renderPage();

    await screen.findByText('Olympic Fencing.');

    expect(screen.queryByRole('link', { name: /view all coaches/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Student Spotlight')).not.toBeInTheDocument();
  });
});

describe('HomePage (logged in)', () => {
  it.each([
    ['parent', '/parent/dashboard'],
    ['coach', '/coach/schedules'],
    ['admin', '/admin/dashboard'],
    ['superadmin', '/admin/dashboard'],
  ])(
    'redirects a %s straight to %s instead of rendering the marketing page',
    async (role, expectedPath) => {
      server.use(
        http.get('*/auth/me', () =>
          HttpResponse.json({
            user: { _id: 'user-1', role, firstName: 'Test', lastName: 'User' },
          })
        )
      );

      renderPage();

      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(expectedPath));

      expect(screen.queryByText('Olympic Fencing.')).not.toBeInTheDocument();
    }
  );

  it('renders the public marketing page for a logged-in student (no dedicated dashboard), without redirecting', async () => {
    server.use(
      http.get('*/auth/me', () =>
        HttpResponse.json({
          user: { _id: 'student-1', role: 'student', firstName: 'Kid', lastName: 'One' },
        })
      )
    );

    renderPage();

    expect(await screen.findByText('Olympic Fencing.')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
