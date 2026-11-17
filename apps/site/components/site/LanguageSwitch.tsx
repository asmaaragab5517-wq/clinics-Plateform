'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { otherLocale, t, type Locale } from '@/lib/i18n';

/** Switches locale and keeps the current path and query (FR-WEB-1). Full navigation so <html lang dir> updates. */
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? `/${locale}`;
  const search = useSearchParams();
  const target = otherLocale(locale);
  const rest = pathname.replace(/^\/(ar|en)(?=\/|$)/, '');
  const qs = search?.toString();
  const href = `/${target}${rest}${qs ? `?${qs}` : ''}`;
  return (
    <a href={href} hrefLang={target} lang={target} title={t(locale, 'lang.switchTo')} className="btn-secondary btn-sm">
      {t(locale, 'lang.switch')}
    </a>
  );
}
