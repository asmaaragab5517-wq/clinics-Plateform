import Link from 'next/link';
import { headers } from 'next/headers';
import { asLocale, t } from '@/lib/i18n';

export default async function NotFound() {
  const locale = asLocale((await headers()).get('x-locale'));
  return (
    <div className="container-page py-20 text-center">
      <h1 className="mb-3 text-3xl font-bold">{t(locale, 'site.notFound.title')}</h1>
      <p className="mb-6 text-muted">{t(locale, 'site.notFound.text')}</p>
      <Link href={`/${locale}`} className="btn-primary">
        {t(locale, 'site.notFound.home')}
      </Link>
    </div>
  );
}
