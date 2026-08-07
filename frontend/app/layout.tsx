import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Saira, Saira_Condensed } from 'next/font/google';

import { AuthProvider } from './context/AuthContext';
import './globals.css';

const sairaCondensed = Saira_Condensed({
  subsets: ['latin'],
  weight: ['700', '900'],
  variable: '--font-heading',
  display: 'swap',
});

const saira = Saira({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Frisco Fencing Academy',
  description: 'Class management and registration for Frisco Fencing Academy.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sairaCondensed.variable} ${saira.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
