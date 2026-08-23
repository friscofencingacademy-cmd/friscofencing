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

const HEAD_COACH = {
  name: 'Jane Smith',
  title: 'Head Coach',
  body: 'Jane has coached for 15 years.',
  bullets: ['NCAA fencer', 'USFA certified'],
};

const FEATURED_STUDENT = {
  name: 'Alex Doe',
  title: '2026 Regional Champion',
  body: 'Alex trains four days a week.',
  bullets: [],
};

function spotlightsHandler() {
  return http.get('*/spotlights/public', ({ request }) => {
    const type = new URL(request.url).searchParams.get('type');

    if (type === 'coach') {
      return HttpResponse.json({ spotlights: [HEAD_COACH] });
    }
    if (type === 'student') {
      return HttpResponse.json({ spotlights: [FEATURED_STUDENT] });
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
  it('renders the hero, steps, level grid, closing CTA, and footer from real data', async () => {
    renderPage();

    expect(await screen.findByText('Where Frisco learns to fence.')).toBeInTheDocument();
    expect(screen.getByText('Three steps to your first class.')).toBeInTheDocument();
    expect(screen.getByText('Create your free account')).toBeInTheDocument();
    expect(screen.getByText('Add your child')).toBeInTheDocument();
    expect(screen.getByText('Pick a free trial class')).toBeInTheDocument();

    expect(screen.getByText('Every level, one monthly rate.')).toBeInTheDocument();
    expect(await screen.findByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('$120/month')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
    expect(screen.getByText('$180/month')).toBeInTheDocument();

    expect(screen.getByText('Ready to try a class?')).toBeInTheDocument();
    expect(
      screen.getByText('The first one is free. It takes two minutes to book.')
    ).toBeInTheDocument();
    expect(screen.getByText('Frisco HQ · 123 Main St')).toBeInTheDocument();

    const bookLinks = screen.getAllByRole('link', { name: /book a free trial/i });
    expect(bookLinks.every((link) => link.getAttribute('href') === '/register')).toBe(true);

    expect(screen.getByRole('link', { name: /see the schedule/i })).toHaveAttribute(
      'href',
      '/classes'
    );
  });

  it('renders no Levels section when the backend returns none, instead of a placeholder', async () => {
    server.use(http.get('*/levels/public', () => HttpResponse.json({ levels: [] })));

    renderPage();

    await screen.findByText('Where Frisco learns to fence.');

    expect(screen.queryByText(/\$\d+\/month/)).not.toBeInTheDocument();
  });

  it('renders the head coach spotlight with a link to /coaches, and the student spotlight with its eyebrow', async () => {
    renderPage();

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    // The fixture's own title field happens to also read "Head Coach" — so
    // this now matches twice: the static eyebrow label (page.tsx's
    // eyebrow="Head Coach" prop) and the spotlight's title line.
    expect(screen.getAllByText('Head Coach')).toHaveLength(2);
    expect(screen.getByText('NCAA fencer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all coaches/i })).toHaveAttribute(
      'href',
      '/coaches'
    );

    expect(screen.getByText('Alex Doe')).toBeInTheDocument();
    expect(screen.getByText('Student Spotlight')).toBeInTheDocument();
  });

  it('renders neither spotlight section, nor the "View all coaches" link, when the backend has none published', async () => {
    server.use(
      http.get('*/spotlights/public', () => HttpResponse.json({ spotlights: [] }))
    );

    renderPage();

    await screen.findByText('Where Frisco learns to fence.');

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

      expect(screen.queryByText('Where Frisco learns to fence.')).not.toBeInTheDocument();
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

    expect(await screen.findByText('Where Frisco learns to fence.')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
