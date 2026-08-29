import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Big_Shoulders_Text, Inter } from 'next/font/google';

import { AuthProvider } from './context/AuthContext';
import './globals.css';

// Rebranded 2026-08-29 to match the live friscofencingacademy.com WordPress
// site's typography (docs/plans/wordpress-ui-alignment-plan.md, Phase 1) —
// same --font-heading/--font-body variable names, different families.
const bigShoulders = Big_Shoulders_Text({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Frisco Fencing Academy',
  description: 'Class management and registration for Frisco Fencing Academy.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bigShoulders.variable} ${inter.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
