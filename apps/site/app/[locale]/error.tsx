'use client';

import { useParams } from 'next/navigation';
import { asLocale, t } from '@/lib/i18n';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const locale = asLocale(useParams<{ locale: string }>()?.locale);
  return (
    <div className="container-page py-20 text-center">
      <h1 className="mb-3 text-2xl font-bold">{t(locale, 'site.error.title')}</h1>
      <p className="mb-6 text-muted">{t(locale, 'common.error')}</p>
      <button type="button" onClick={reset} className="btn-primary">
        {t(locale, 'site.retry')}
      </button>
    </div>
  );
}
