import { render, screen } from '@testing-library/react';

import TestimonialsSection from '../TestimonialsSection';
import type { PublicTestimonial } from '../../../../lib/types';

const STEVE: PublicTestimonial = {
  quote: 'Training at FFA has helped me feel more confident and disciplined.',
  authorName: 'Steve',
  caption: 'More than a sport, an environment for growth',
  imageUrl: 'https://example.com/steve.jpg',
};

const RYAN: PublicTestimonial = {
  quote: 'What stood out to us was the attention and care our child receives.',
  authorName: 'Ryan',
};

// Replaces TeamBand/SpotlightCard on the home page (2026-08-29) — see
// docs/plans/wordpress-ui-alignment-plan.md's testimonials addendum.
describe('TestimonialsSection', () => {
  it('renders nothing when there are no published testimonials', () => {
    const { container } = render(<TestimonialsSection testimonials={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the banner and each testimonial, duplicated once for the marquee loop', () => {
    render(<TestimonialsSection testimonials={[STEVE, RYAN]} />);

    expect(screen.getByText('What Families Says')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All Testimonials' })).toHaveAttribute(
      'href',
      '/register'
    );

    // Duplicated for the seamless scroll loop — every testimonial appears
    // twice in the DOM.
    expect(screen.getAllByText('by Steve')).toHaveLength(2);
    expect(screen.getAllByText('by Ryan')).toHaveLength(2);
    expect(screen.getAllByText(STEVE.quote)).toHaveLength(2);
    expect(screen.getAllByText('More than a sport, an environment for growth')).toHaveLength(2);
  });

  it('renders a testimonial with no caption or photo using the fallback, without crashing', () => {
    render(<TestimonialsSection testimonials={[RYAN]} />);

    expect(screen.getAllByText('by Ryan')).toHaveLength(2);
    expect(screen.queryByText(/more than a sport/i)).not.toBeInTheDocument();
  });
});
