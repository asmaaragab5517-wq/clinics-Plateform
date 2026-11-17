import Link from 'next/link';
import { getT, type Locale } from '@/lib/i18n';

export function SiteFooter({ locale }: { locale: Locale }) {
  const tt = getT(locale);
  const col = (title: string, links: [string, string][]) => (
    <div>
      <h2 className="mb-2 text-sm font-bold">{title}</h2>
      <ul className="space-y-1 text-sm text-muted">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={`/${locale}${href}`} className="hover:text-primary">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="container-page grid grid-cols-1 gap-8 py-10 sm:grid-cols-3">
        {col(tt('footer.explore'), [
          ['/doctors', tt('nav.doctors')],
          ['/clinics', tt('nav.clinics')],
          ['/specialties', tt('nav.specialties')],
          ['/services', tt('nav.services')],
          ['/articles', tt('nav.articles')],
        ])}
        {col(tt('footer.patients'), [
          ['/book', tt('nav.book')],
          ['/portal', tt('nav.portal')],
          ['/verify/rx', tt('footer.verifyRx')],
        ])}
        {col(tt('footer.legal'), [
          ['/privacy', tt('privacy.title')],
          ['/terms', tt('terms.title')],
        ])}
      </div>
      <p className="container-page border-t border-border py-4 text-xs text-muted">{tt('footer.rights', { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
