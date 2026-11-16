import Link from 'next/link';
import { Suspense } from 'react';
import { getT, type Locale } from '@/lib/i18n';
import { LanguageSwitch } from './LanguageSwitch';

const NAV = [
  ['/doctors', 'nav.doctors'],
  ['/clinics', 'nav.clinics'],
  ['/specialties', 'nav.specialties'],
  ['/services', 'nav.services'],
  ['/articles', 'nav.articles'],
] as const;

export function SiteHeader({ locale }: { locale: Locale }) {
  const tt = getT(locale);
  return (
    <header className="border-b border-border bg-surface">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} className="font-display text-lg font-bold text-primary sm:text-xl">
          {tt('app.name')}
        </Link>
        <nav aria-label={tt('site.menu')} className="hidden lg:block">
          <ul className="flex items-center gap-5 text-sm">
            {NAV.map(([href, key]) => (
              <li key={href}>
                <Link href={`/${locale}${href}`} className="hover:text-primary">
                  {tt(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <Suspense fallback={null}>
            <LanguageSwitch locale={locale} />
          </Suspense>
          <Link href={`/${locale}/portal`} className="btn-secondary btn-sm hidden sm:inline-flex">
            {tt('nav.portal')}
          </Link>
          <Link href={`/${locale}/book`} className="btn-primary btn-sm">
            {tt('nav.book')}
          </Link>
          <details className="relative lg:hidden">
            <summary className="btn-secondary btn-sm cursor-pointer list-none" aria-label={tt('site.menu')}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden fill="currentColor">
                <path d="M3 5h14v2H3zM3 9h14v2H3zM3 13h14v2H3z" />
              </svg>
            </summary>
            <nav aria-label={tt('site.menu')} className="absolute end-0 top-10 z-40 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
              <ul className="flex flex-col">
                {NAV.map(([href, key]) => (
                  <li key={href}>
                    <Link href={`/${locale}${href}`} className="block rounded-lg px-3 py-2 hover:bg-bg">
                      {tt(key)}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href={`/${locale}/portal`} className="block rounded-lg px-3 py-2 hover:bg-bg">
                    {tt('nav.portal')}
                  </Link>
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
