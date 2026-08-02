import type { Metadata, Viewport } from 'next';
import Link from 'next/link';

import { DISCLAIMER } from '@/lib/compliance';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PFL Financial Advisors — Retirement Health Score',
    template: '%s | PFL Financial Advisors',
  },
  description:
    'Answer eight questions and get an instant, personalised Retirement Health Score with a breakdown of where your plan stands. Free, takes two minutes.',
  openGraph: {
    title: 'What is your Retirement Health Score?',
    description:
      'Eight questions, two minutes, an instant score out of 100 with a personalised breakdown.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f2a47',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-parchment"
        >
          Skip to content
        </a>

        <header className="no-print border-b border-line bg-parchment/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-serif text-xl font-semibold tracking-tight text-ink">PFL</span>
              <span className="hidden text-sm text-ink-muted sm:inline">Financial Advisors</span>
            </Link>
            <Link
              href="/quiz"
              className="rounded-md border border-ink px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink hover:text-parchment"
            >
              Check my score
            </Link>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="no-print mt-20 border-t border-line bg-parchment-deep">
          <div className="mx-auto max-w-5xl px-5 py-10 text-sm text-ink-soft">
            <p className="max-w-2xl">{DISCLAIMER}</p>
            <p className="mt-4 max-w-2xl">
              PFL Financial Advisors is an authorised financial services provider in terms of the
              Financial Advisory and Intermediary Services Act, 2002 (FAIS). KwaZulu-Natal, South
              Africa.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
                Privacy &amp; POPIA notice
              </Link>
              <Link href="/quiz" className="underline underline-offset-4 hover:text-ink">
                Retirement Health Score
              </Link>
            </div>
            <p className="mt-6 text-xs text-ink-muted">
              © {new Date().getFullYear()} PFL Financial Advisors. All rights reserved.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
