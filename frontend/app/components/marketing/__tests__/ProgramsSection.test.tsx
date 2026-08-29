import { render, screen } from '@testing-library/react';

import ProgramsSection from '../ProgramsSection';

// Static marketing content (2026-08-29) — replaces the old data-driven
// LevelGrid. See docs/plans/wordpress-ui-alignment-plan.md's addendum.
describe('ProgramsSection', () => {
  it('renders all three programs with their verbatim copy, unconditionally', () => {
    render(<ProgramsSection />);

    expect(screen.getByText('A clear path for every stage')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Beginner' })).toBeInTheDocument();
    expect(screen.getByText('6–12 months')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Intermediate' })).toBeInTheDocument();
    expect(screen.getByText('12–18 months')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.getByText('18 months+')).toBeInTheDocument();
  });

  it('shows no pricing and links every "Know more" CTA to /register', () => {
    render(<ProgramsSection />);

    expect(screen.queryByText(/\$\d+\/month/)).not.toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /know more/i });
    expect(links).toHaveLength(3);
    links.forEach((link) => expect(link).toHaveAttribute('href', '/register'));
  });

  it('renders a progressively-filled dot icon per program (6, 8, then 9 of 9)', () => {
    const { container } = render(<ProgramsSection />);

    const dotIcons = container.querySelectorAll('svg[width="39"][height="38"]');
    expect(dotIcons).toHaveLength(3);
    expect(dotIcons[0].querySelectorAll('circle')).toHaveLength(6);
    expect(dotIcons[1].querySelectorAll('circle')).toHaveLength(8);
    expect(dotIcons[2].querySelectorAll('circle')).toHaveLength(9);
  });
});
