import { render, screen } from '@testing-library/react';

import Hero from '../Hero';

// Covers the 2026-08-29 video-hero addendum (docs/plans/wordpress-ui-alignment-plan.md):
// a <video> background gated to desktop via a single <source media="...">, with a poster
// image that's also all phones ever download, plus the restored subheading/button copy
// from the owner's live-site reference screenshot.
describe('Hero', () => {
  it('renders the poster-fallback video with a single desktop-gated source', () => {
    render(<Hero />);

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('poster', '/marketing/hero-poster.jpg');
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('loop');
    // React manages `muted` as a DOM property, not an HTML attribute (same
    // family as `value`/`defaultValue`), so it's asserted via the property.
    expect((video as HTMLVideoElement).muted).toBe(true);

    const source = video?.querySelector('source');
    expect(source).toHaveAttribute('src', '/marketing/hero-video.mp4');
    expect(source).toHaveAttribute('media', '(min-width: 768px)');
  });

  it('renders the restored headline, subheading, and button copy', () => {
    render(<Hero />);

    expect(screen.getByRole('heading', { name: 'Olympic Fencing.' })).toBeInTheDocument();
    expect(screen.getByText('Child-First Training')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Take a Trial Class' })).toHaveAttribute(
      'href',
      '/register'
    );
    expect(screen.getByRole('link', { name: 'Book Private Class with Coach' })).toHaveAttribute(
      'href',
      '/private-classes'
    );
  });
});
