import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from './context/AuthContext';

export const metadata: Metadata = {
  title: 'Frisco Fencing Academy',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
