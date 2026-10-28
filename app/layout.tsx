import './globals.css';
import type { ReactNode } from 'react';
import Providers from '@/components/Providers';

export const metadata = { title: 'Chomperfly' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
