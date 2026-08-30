import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import HomePage from '../page';
import { AuthProvider } from '../context/AuthContext';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

// phone/email always present (docs/plans/frontend-polish-plan.md PR 5.3) —
// non-empty here so the default happy-path test exercises real tel:/
// mailto: links; a dedicated test below covers the empty-string case.
const LOCATION = {
  name: 'Frisco HQ',
  address: '123 Main St',
  timezone: 'America/Chicago',
  phone: '(214) 555-0100',
  email: 'info@friscofencingacademy.com',
};

const STEVE_TESTIMONIAL = {
  quote: 'Training at FFA has helped me feel more confident and disciplined.',
  authorName: 'Steve',
  caption: 'More than a sport, an environment for growth',
};

function testimonialsHandler(testimonials: unknown[] = [STEVE_TESTIMONIAL]) {
  return http.get('*/testimonials/public', () => HttpResponse.json({ testimonials }));
}

const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
  http.get('*/locations/public', () => HttpResponse.json({ locations: [LOCATION] })),
  testimonialsHandler()
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

    // ProgramsSection is static marketing content (2026-08-29), not
    // backend-driven — see docs/plans/wordpress-ui-alignment-plan.md's
    // addendum. All three programs always render regardless of what
    // levels/pricing the backend has configured.
    expect(screen.getByText('A clear path for every stage')).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();

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

  // docs/plans/frontend-polish-plan.md PR 5.3 — public phone/email live on
  // Location, editable by the owner via the admin form; the public site
  // renders a real link only when the owner has actually set one.
  describe('contact info (Location.phone/email)', () => {
    it('renders tel:/mailto: links with the correct hrefs, both in ContactBlock and SiteFooter, when phone/email are set', async () => {
      renderPage();

      await screen.findByText('Olympic Fencing.');

      const phoneLinks = screen.getAllByRole('link', { name: '(214) 555-0100' });
      expect(phoneLinks.length).toBeGreaterThan(0);
      phoneLinks.forEach((link) => expect(link).toHaveAttribute('href', 'tel:(214) 555-0100'));

      const emailLinks = screen.getAllByRole('link', { name: 'info@friscofencingacademy.com' });
      expect(emailLinks.length).toBeGreaterThan(0);
      emailLinks.forEach((link) =>
        expect(link).toHaveAttribute('href', 'mailto:info@friscofencingacademy.com')
      );
    });

    it('renders no phone/email links — no dead links — when a location has neither set', async () => {
      server.use(
        http.get('*/locations/public', () =>
          HttpResponse.json({
            locations: [{ name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago', phone: '', email: '' }],
          })
        )
      );

      renderPage();

      await screen.findByText('Olympic Fencing.');

      expect(screen.queryByRole('link', { name: /^tel:/i })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('link').some((link) => link.getAttribute('href')?.startsWith('tel:'))).toBe(
        false
      );
      expect(
        screen.queryAllByRole('link').some((link) => link.getAttribute('href')?.startsWith('mailto:'))
      ).toBe(false);
    });

    it('still shows the static contact line — never a blank page — when both /locations/public and /testimonials/public fail', async () => {
      server.use(
        http.get('*/locations/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
        http.get('*/testimonials/public', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
      );

      renderPage();

      expect(await screen.findByText('Olympic Fencing.')).toBeInTheDocument();
      expect(screen.getByText(/call or email us to book a class/i)).toBeInTheDocument();
      // Both ContactBlock and SiteFooter carry their own YouTube link —
      // every one of them must still point at the real URL.
      const youtubeLinks = screen.getAllByRole('link', { name: 'YouTube' });
      expect(youtubeLinks.length).toBeGreaterThan(0);
      youtubeLinks.forEach((link) =>
        expect(link).toHaveAttribute('href', 'https://www.youtube.com/@BrainsBehindBlades')
      );
    });
  });

  it('renders each program\'s duration/description copy and a "Take Trial Class" link to /register', async () => {
    renderPage();

    await screen.findByText('Olympic Fencing.');

    expect(screen.getByText('6–12 months')).toBeInTheDocument();
    expect(screen.getByText('12–18 months')).toBeInTheDocument();
    expect(screen.getByText('18 months+')).toBeInTheDocument();
    expect(
      screen.getByText(/A calm supportive environment where students learn the fundamentals/)
    ).toBeInTheDocument();

    const programCtaLinks = screen.getAllByRole('link', { name: /^take trial class$/i });
    expect(programCtaLinks).toHaveLength(3);
    expect(programCtaLinks.every((link) => link.getAttribute('href') === '/register')).toBe(true);
  });

  it('renders every published testimonial in the marquee, plus the "What Families Says" banner', async () => {
    renderPage();

    expect(await screen.findAllByText('by Steve')).toHaveLength(2);
    expect(
      screen.getAllByText('Training at FFA has helped me feel more confident and disciplined.')
    ).toHaveLength(2);
    expect(screen.getByText('What Families Says')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All Testimonials' })).toHaveAttribute(
      'href',
      '/register'
    );
  });

  it('renders no testimonials section when the backend has none published', async () => {
    server.use(http.get('*/testimonials/public', () => HttpResponse.json({ testimonials: [] })));

    renderPage();

    await screen.findByText('Olympic Fencing.');

    expect(screen.queryByText('What Families Says')).not.toBeInTheDocument();
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
