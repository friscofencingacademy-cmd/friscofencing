import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';

import { AuthProvider } from './context/AuthContext';
import './globals.css';

// Self-hosted from the @fontsource-variable npm packages, never fetched from
// Google at build time: next/font/google downloads the CSS during `next
// build`, and one transient bad response from Google failed a develop CI
// build (2026-09-30, "An error occurred in `next/font`") — the same failure
// would fail a Vercel deploy. Versioned by package.json like any other
// dependency; next/font/local still preloads and size-adjusts the fallback.
// Variable fonts, so one file covers every weight the site uses.
// Typography matches the live friscofencingacademy.com site
// (docs/plans/wordpress-ui-alignment-plan.md, Phase 1).
const bigShoulders = localFont({
  src: '../node_modules/@fontsource-variable/big-shoulders-text/files/big-shoulders-text-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-heading',
  display: 'swap',
});

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-body',
  display: 'swap',
});

// Handwriting-style font for TestimonialsSection's polaroid captions,
// mirroring the live site's own handwritten-note look (2026-08-29).
const caveat = localFont({
  src: '../node_modules/@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2',
  weight: '400 700',
  variable: '--font-handwriting',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Frisco Fencing Academy',
  description: 'Class management and registration for Frisco Fencing Academy.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bigShoulders.variable} ${inter.variable} ${caveat.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
