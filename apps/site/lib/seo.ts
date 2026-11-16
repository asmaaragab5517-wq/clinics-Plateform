import type { Metadata } from 'next';
import { SITE_URL } from './config';
import { LOCALES, t, type Locale } from './i18n';

export function localeUrl(locale: Locale, path = ''): string {
  return `${SITE_URL}/${locale}${path}`;
}

/** Canonical + hreflang alternates (FR-WEB-4). `path` starts with "/" or is empty. */
export function alternates(locale: Locale, path = ''): Metadata['alternates'] {
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l === 'ar' ? 'ar-EG' : 'en', localeUrl(l, path)]));
  languages['x-default'] = localeUrl('ar', path);
  return { canonical: localeUrl(locale, path), languages };
}

export function pageMetadata(opts: { locale: Locale; path: string; title: string; description?: string; type?: 'website' | 'article' | 'profile'; noindex?: boolean }): Metadata {
  const { locale, path, title } = opts;
  const description = opts.description ?? t(locale, 'site.description');
  return {
    title,
    description,
    alternates: alternates(locale, path),
    openGraph: {
      type: opts.type ?? 'website',
      title,
      description,
      url: localeUrl(locale, path),
      siteName: t(locale, 'app.name'),
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      alternateLocale: locale === 'ar' ? ['en_US'] : ['ar_EG'],
    },
    twitter: { card: 'summary_large_image', title, description },
    ...(opts.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function excerpt(text: string | null | undefined, max = 160): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
